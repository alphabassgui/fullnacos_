import logging
import os
from datetime import datetime
from celery import Celery
from redis.exceptions import (
    ConnectionError as RedisConnectionError,
    TimeoutError as RedisTimeoutError,
)
from kombu.exceptions import OperationalError as KombuOperationalError
from firebase_admin import firestore
from sqlalchemy.dialects.postgresql import insert as pg_insert

from extensions import db as orm_db
from models import AgentRun, GtmRun, Observation, get_business_row
from website_analyzer import fetch_website_html, analyze_html
from services.execution_engine import execute_action

logger = logging.getLogger(__name__)


def _normalize_domain(value):
    """Reduce a domain or URL to a comparable key.

    Lowercases, drops any scheme and path/query, and strips a leading "www."
    so that e.g. "https://www.Foo.com/x" and "foo.com" both yield "foo.com".
    """
    if not value:
        return ""
    s = str(value).strip().lower()
    if "://" in s:
        s = s.split("://", 1)[1]
    # Drop path, query, and fragment — keep only the host portion.
    for sep in ("/", "?", "#"):
        s = s.split(sep, 1)[0]
    if s.startswith("www."):
        s = s[4:]
    return s


redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery = Celery(
    "ai_growth_agent",
    broker=redis_url,
    backend=redis_url,
)


class ContextTask(celery.Task):
    """Run every task body inside a Flask application context so SQLAlchemy
    `db.session` (Postgres, from the Firestore->Supabase migration) works in the
    worker. The worker is started with `celery -A task worker` and never pushes
    an app context on its own; the parent-business lookup (and the services it
    calls) now read Postgres, which requires one.

    The `from app import app` is LAZY (inside __call__, not at module top) so the
    worker's import of this module stays free of the app<->routes<->task import
    cycle — by the time a task actually runs, `app` is fully imported.
    """

    def __call__(self, *args, **kwargs):
        from app import app

        with app.app_context():
            return super().__call__(*args, **kwargs)


celery.Task = ContextTask

# acks_late + reject_on_worker_lost: a crash/redeploy mid-task (the single
# --pool=solo worker lives inside the Render web service) redelivers the task
# instead of silently dropping it. Safe only because every write on this path is
# now idempotent (deterministic doc ids + dedupe guards). result_expires bounds
# Redis result keys so they don't accumulate on the 512MB free tier.
celery.conf.task_acks_late = True
celery.conf.task_reject_on_worker_lost = True
celery.conf.result_expires = 86400  # 24h

# Retry ONLY transient broker/redis/transport errors. This is deliberately an
# allow-list: groq.RateLimitError/429 (owned by agent/groq_client.py's in-call
# retry+failover) and all deterministic logic/validation errors (ValueError,
# PermissionError — "Business not found", "no website_url", "Action must be
# approved", etc.) are NOT listed, so they never retry and never burn budget.
TRANSIENT_BROKER_ERRORS = (
    RedisConnectionError,
    RedisTimeoutError,
    KombuOperationalError,
)
RETRY_OPTS = dict(
    autoretry_for=TRANSIENT_BROKER_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)


@celery.task(
    bind=True,
    name="tasks.execute_approved_action",
    **RETRY_OPTS,
)
def execute_approved_action(
    self,
    business_id,
    execution_id,
):
    return execute_action(
        business_id,
        execution_id,
    )

@celery.task(bind=True, name="tasks.analyze_business_website", **RETRY_OPTS)
def analyze_business_website(self, business_id, user_id, run_id):
    # The analyze_business route always pre-creates the agent_run row before
    # dispatching this task, so run is present here. (observations.run_id FKs
    # agent_runs.id, so the run must exist before the observation upsert.)
    run = orm_db.session.get(AgentRun, run_id)

    def _fail_run(error):
        if run is not None:
            run.analysis_status = "failed"
            run.status = "failed"
            run.error = error
            run.completed_at = datetime.utcnow()
            orm_db.session.commit()

    # Parent business now lives in Postgres alongside its children.
    business = get_business_row(business_id)

    if business is None:
        _fail_run("Business not found")
        return {
            "success": False,
            "error": "Business not found",
        }

    if str(business.owner_id) != user_id:
        _fail_run("Unauthorized")
        return {
            "success": False,
            "error": "Unauthorized",
        }

    website_url = business.website_url

    if not website_url:
        _fail_run("Business has no website URL")
        return {
            "success": False,
            "error": "Business has no website URL",
        }

    try:
        # Mark job as running
        if run is not None:
            run.analysis_status = "running"
            run.started_at = datetime.utcnow()
            orm_db.session.commit()

        # Fetch website. A blocked (403/429), unreachable, or otherwise
        # non-200 site must end the run in a clean failed state the frontend
        # can display — never crash the Celery task with an unhandled
        # exception. (website_analyzer already tries realistic headers + a
        # Playwright fallback before surfacing a failure here.)
        try:
            html, final_url = fetch_website_html(website_url)
        except Exception as exc:
            _fail_run(str(exc))
            return {
                "success": False,
                "error": str(exc),
            }

        # Analyze HTML
        analysis = analyze_html(html)

        # Save observation
        observation = {
            "business_id": business_id,
            "owner_id": user_id,
            "source_url": website_url,
            "final_url": final_url,
            "analysis": analysis,
            "analysis_status": "completed",
            "created_at": datetime.utcnow().isoformat(),
        }

        # Deterministic id keyed on run_id: a task redelivery (acks_late) must
        # overwrite the same observation row, not append a duplicate. The PK
        # ON CONFLICT upsert replaces the @firestore set(run_id) behavior.
        now = datetime.utcnow()
        stmt = (
            pg_insert(Observation)
            .values(
                run_id=run_id,
                business_id=business_id,
                owner_id=user_id,
                source_url=website_url,
                final_url=final_url,
                analysis=analysis,
                analysis_status="completed",
                created_at=now,
            )
            .on_conflict_do_update(
                index_elements=["run_id"],
                set_={
                    "business_id": business_id,
                    "owner_id": user_id,
                    "source_url": website_url,
                    "final_url": final_url,
                    "analysis": analysis,
                    "analysis_status": "completed",
                    "created_at": now,
                },
            )
        )
        orm_db.session.execute(stmt)
        orm_db.session.commit()

        observation_id = run_id

        # Step 4-7: business understanding + opportunities.
        # Lazy imports avoid constructing a Groq() client when task.py loads.
        from agent.analyzer import analyze_observation
        from agent.opportunity_generator import generate_opportunities
        from services.opportunity_service import create_opportunity
        from services.opportunity_action_service import generate_actions_for_opportunities

        try:
            analysis = analyze_observation(observation)

            opportunities = generate_opportunities(analysis)

            opportunity_ids = []

            for position, opp in enumerate(opportunities):
                # Per-item isolation: a single invalid AI-generated opportunity
                # (off-list type/problem_key, missing key, bad evidence/
                # confidence) must not fail the whole run. Skip & log it so the
                # valid opportunities from the same run still persist.
                try:
                    result = create_opportunity(
                        business_id=business_id,
                        opportunity=opp,
                        owner_id=user_id,
                    )

                    opportunity_ids.append(result["id"])
                except Exception as exc:
                    logger.warning(
                        "Skipping invalid opportunity at position %s "
                        "(type=%s): %s",
                        position,
                        opp.get("type") if isinstance(opp, dict) else None,
                        exc,
                    )
                    continue

            planner_result = generate_actions_for_opportunities(
                business_id=business_id,
                owner_id=user_id,
                business_analysis=analysis,
                opportunity_ids=opportunity_ids,
            )

            # Single terminal completed transition
            if run is not None:
                completed_now = datetime.utcnow()
                run.analysis_status = "completed"
                run.status = "awaiting_approval"
                run.observation_id = observation_id
                run.opportunity_ids = opportunity_ids
                run.actions_created = planner_result.get("actions_created", 0)
                run.actions_existing = planner_result.get("actions_existing", 0)
                run.completed_at = completed_now
                run.updated_at = completed_now
                orm_db.session.commit()

        except Exception as exc:
            orm_db.session.rollback()
            _fail_run(str(exc))
            raise

        return {
            "success": True,
            "observation_id": observation_id,
            "opportunity_ids": opportunity_ids,
            "actions_created": planner_result["actions_created"],
            "actions_existing": planner_result["actions_existing"],
            "run_id": run_id,
        }

    except Exception as exc:
        # Mark run as failed
        orm_db.session.rollback()
        _fail_run(str(exc))

        raise

@celery.task(bind=True, name="tasks.run_agent_cycle", **RETRY_OPTS)
def run_agent_cycle(self, business_id, user_id, run_id):
    run = orm_db.session.get(AgentRun, run_id)

    # Idempotency: if a prior delivery already dispatched the analysis child
    # (analysis_task_id is the dispatch marker set after the first .delay), a
    # redelivery of run_agent_cycle must NOT enqueue a second child. Missing run
    # row -> {} -> proceed normally (don't crash).
    existing_task_id = run.analysis_task_id if run is not None else None
    if existing_task_id:
        return {
            "success": True,
            "run_id": run_id,
            "analysis_task_id": existing_task_id,
            "already_dispatched": True,
        }

    if run is not None:
        run.status = "running"
        run.analysis_status = "queued"
        run.cycle_started_at = datetime.utcnow()
        orm_db.session.commit()

    try:
        result = analyze_business_website.delay(
            business_id=business_id,
            user_id=user_id,
            run_id=run_id,
        )

        if run is not None:
            run.analysis_task_id = result.id
            run.analysis_status = "queued"
            run.updated_at = datetime.utcnow()
            orm_db.session.commit()

        return {
            "success": True,
            "run_id": run_id,
            "analysis_task_id": result.id,
        }

    except Exception as exc:
        if run is not None:
            orm_db.session.rollback()
            run.status = "failed"
            run.error = str(exc)
            run.completed_at = datetime.utcnow()
            orm_db.session.commit()
        raise


@celery.task(bind=True, name="tasks.run_gtm_analysis", **RETRY_OPTS)
def run_gtm_analysis(self, business_id, user_id, run_id):
    """
    Asynchronous Visual GTM Analysis Task.

    Coordinates:
    1. PixelRAG user website vertical page capture & tiling.
    2. Competitor discovery via GSC organic queries.
    3. PixelRAG competitor page capture.
    4. Vision LLM evaluation across 4 GTM pillars.
    5. Persistence of structured GTM opportunities and executive dossier.
    """
    # Resolve the GtmRun row from Postgres. A non-UUID run_id (e.g. from unit
    # tests that pass string ids) is handled by the UUID guard below — the task
    # soft-fails the DB lookup and continues without run tracking, matching the
    # soft-fail pattern of analyze_business_website.
    run = None
    try:
        import uuid as _uuid_mod
        _uuid_mod.UUID(str(run_id))
        run = orm_db.session.get(GtmRun, run_id)
    except (ValueError, TypeError, AttributeError):
        pass

    if run is not None:
        run.status = "running"
        run.started_at = datetime.utcnow()
        orm_db.session.commit()

    try:
        from services.pixelrag_service import render_and_tile_page
        from services.gtm_discovery_service import (
            discover_competitors,
            get_gtm_seed_queries,
        )
        from agent.gtm_engine import analyze_gtm_tiles
        from services.gtm_dossier_service import (
            generate_gtm_dossier_markdown,
            save_dossier_to_file,
        )
        from services.opportunity_service import create_opportunity

        # 1. Fetch business (Postgres; gtm_runs also in Postgres now)
        business = get_business_row(business_id)
        if business is None:
            raise ValueError("Business not found")
        website_url = business.website_url
        if not website_url:
            raise ValueError("Business has no website_url configured")

        tiles_base_dir = f"static/tiles/{business_id}/{run_id}"

        # 2. Tile User Website
        user_tiles_dir = f"{tiles_base_dir}/user_site"
        user_manifest = render_and_tile_page(website_url, user_tiles_dir)

        # 3. Discover Competitors & Tile
        # Seed queries feed BOTH competitor discovery and the vision prompt, and
        # get_gtm_seed_queries can hit the GSC API + a Firestore read — compute
        # them once here and thread the single result through both consumers.
        seed_queries = get_gtm_seed_queries(business_id, user_id)
        competitors = discover_competitors(
            business_id,
            user_id,
            max_competitors=2,
            seed_queries=seed_queries,
        )
        competitor_manifests = []
        for idx, comp in enumerate(competitors, start=1):
            comp_url = comp.get("url")
            if comp_url:
                try:
                    comp_dir = f"{tiles_base_dir}/comp_{idx}"
                    comp_manifest = render_and_tile_page(comp_url, comp_dir)
                    comp["manifest"] = comp_manifest
                    competitor_manifests.append(comp_manifest)
                except Exception as exc:
                    pass

        # 4. Evaluate via Vision LLM (reusing the seed queries from step 3)
        analysis_result = analyze_gtm_tiles(
            user_manifest=user_manifest,
            competitor_manifests=competitor_manifests,
            search_queries=seed_queries,
        )

        gtm_scores = analysis_result.get("gtm_scores", {})
        blind_spots = analysis_result.get("blind_spots", [])
        opportunities_data = analysis_result.get("opportunities", [])
        competitor_insights = analysis_result.get("competitor_insights") or []

        # Merge per-competitor strengths/weaknesses from the vision engine into
        # the `competitors` list IN PLACE, keyed by normalized domain. This list
        # is the single source for both the dossier (run_summary) and the
        # persisted run doc, so mutating it once wires the data through both.
        # Defensive: this runs inside a Celery task, so any unexpected shape in
        # competitor_insights must leave empty lists rather than raise.
        try:
            # Ensure a consistent shape even with no insights / no matches.
            for comp in competitors:
                comp["strengths"] = []
                comp["weaknesses"] = []

            if isinstance(competitor_insights, list) and competitor_insights:
                insight_by_domain = {}
                for insight in competitor_insights:
                    if not isinstance(insight, dict):
                        continue
                    key = _normalize_domain(insight.get("domain"))
                    if key:
                        insight_by_domain.setdefault(key, insight)

                matched_any = False
                for comp in competitors:
                    key = _normalize_domain(comp.get("domain") or comp.get("url"))
                    insight = insight_by_domain.get(key)
                    if insight is not None:
                        matched_any = True
                        comp["strengths"] = insight.get("strengths") or []
                        comp["weaknesses"] = insight.get("weaknesses") or []

                # Fall back to index-order alignment ONLY when no domains lined
                # up at all and the two lists are the same length.
                if not matched_any and len(competitors) == len(competitor_insights):
                    for comp, insight in zip(competitors, competitor_insights):
                        if isinstance(insight, dict):
                            comp["strengths"] = insight.get("strengths") or []
                            comp["weaknesses"] = insight.get("weaknesses") or []
        except Exception as exc:
            logger.warning(
                "Failed to merge GTM competitor insights for business %s: %s",
                business_id,
                exc,
            )
            for comp in competitors:
                comp.setdefault("strengths", [])
                comp.setdefault("weaknesses", [])

        # 5. Persist Opportunities
        created_opp_ids = []
        for opp in opportunities_data:
            try:
                created = create_opportunity(
                    business_id=business_id,
                    opportunity=opp,
                    owner_id=user_id,
                )
                if created and "id" in created:
                    created_opp_ids.append(created["id"])
            except Exception as exc:
                logger.warning(
                    "Failed to persist GTM opportunity for business %s: %s",
                    business_id,
                    exc,
                )

        # 6. Generate & Save Executive Dossier
        run_summary = {
            "id": run_id,
            "created_at": datetime.utcnow().isoformat(),
            "user_website": {
                "url": website_url,
                "tiles": user_manifest.get("tiles", []),
            },
            "competitors_analyzed": competitors,
            "gtm_scores": gtm_scores,
            "blind_spots": blind_spots,
            "opportunities": opportunities_data,
        }
        dossier_md = generate_gtm_dossier_markdown(run_summary)
        dossier_path = save_dossier_to_file(run_id, business_id, dossier_md)

        # 7. Complete Run in Postgres
        if run is not None:
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            run.gtm_scores = gtm_scores
            run.blind_spots = blind_spots
            run.competitors_analyzed = competitors
            run.user_manifest = user_manifest
            run.opportunities_created_count = len(created_opp_ids)
            run.dossier_path = dossier_path
            orm_db.session.commit()

        return {
            "success": True,
            "run_id": run_id,
            "gtm_scores": gtm_scores,
            "opportunities_count": len(created_opp_ids),
        }

    except Exception as exc:
        if run is not None:
            orm_db.session.rollback()
            run.status = "failed"
            run.error = str(exc)
            run.completed_at = datetime.utcnow()
            orm_db.session.commit()
        raise