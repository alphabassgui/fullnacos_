"""Cheap guard against silent regression of the Celery hardening config:
acks_late / reject_on_worker_lost / result_expires / bounded narrow retry.
"""
import pytest
from celery.exceptions import Retry
from redis.exceptions import ConnectionError as RedisConnectionError

import task as task_mod


def test_acks_late_and_reject_on_worker_lost_enabled():
    # Without these a crash/redeploy mid-task silently drops the task.
    assert task_mod.celery.conf.task_acks_late is True
    assert task_mod.celery.conf.task_reject_on_worker_lost is True


def test_result_expires_is_bounded():
    # Bound Redis result keys on the 512MB free tier.
    assert task_mod.celery.conf.result_expires == 86400


def test_retry_is_bounded_and_transient_only():
    task = task_mod.analyze_business_website
    assert task.max_retries == 3
    # Allow-list: transient broker/redis errors retry...
    assert RedisConnectionError in task.autoretry_for
    # ...deterministic logic errors never do.
    assert ValueError not in task.autoretry_for
    assert PermissionError not in task.autoretry_for


def test_retry_opts_applied_to_all_tasks():
    for task in (
        task_mod.execute_approved_action,
        task_mod.analyze_business_website,
        task_mod.run_agent_cycle,
        task_mod.run_gtm_analysis,
    ):
        assert task.max_retries == 3
        assert task.autoretry_for == task_mod.TRANSIENT_BROKER_ERRORS


@pytest.fixture
def eager_celery():
    return task_mod


def test_transient_error_retries_logic_error_does_not(eager_celery):
    task_mod = eager_celery

    @task_mod.celery.task(
        bind=True, name="tests.probe_transient", **task_mod.RETRY_OPTS
    )
    def probe_transient(self):
        raise RedisConnectionError("broker down")

    @task_mod.celery.task(
        bind=True, name="tests.probe_logic", **task_mod.RETRY_OPTS
    )
    def probe_logic(self):
        raise ValueError("deterministic")

    # Transient broker error -> a retry is scheduled (Retry raised).
    with pytest.raises(Retry):
        probe_transient.apply(throw=True)

    # Deterministic logic error -> NOT retried; the original error propagates.
    with pytest.raises(ValueError):
        probe_logic.apply(throw=True)
