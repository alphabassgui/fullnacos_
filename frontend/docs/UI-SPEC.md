GROVILLE MVP UI SPECIFICATION  
AI Growth Marketing Manager — Full User Testing UI

Purpose  
\-------  
This document defines everything the MVP UI should contain so a real user can:  
1\. Create/login to an account.  
2\. Add a business and paste a website URL.  
3\. Start an AI growth analysis.  
4\. See the agent observe and analyze the website.  
5\. Review opportunities discovered by the agent.  
6\. Review proposed actions.  
7\. Approve an action.  
8\. See execution progress and result.  
9\. See measurement and learning.  
10\. Start another cycle and understand what the agent learned.

MVP CONNECTORS  
\--------------  
Available:  
\- Website  
\- GitHub

On hold:  
\- Instagram (Meta developer account not available yet)

Important:  
\- Do NOT present Instagram as connected/available.  
\- Website execution is currently DRY-RUN. The UI must clearly say that website actions are validated/prepared but no live website changes are made.  
\- GitHub actions can be shown only where a GitHub connection/action actually exists.  
\- Do not imply that the product has autonomous ad spending or live social publishing.

GLOBAL UX PRINCIPLES  
\--------------------  
\- The user should always know:  
  \- What the agent is doing.  
  \- What it found.  
  \- Why it matters.  
  \- What it wants to do.  
  \- Whether the user needs to approve something.  
  \- What happened afterward.  
  \- What the agent learned.  
\- Every async operation needs a visible state:  
  queued, running, completed, failed, or awaiting approval.  
\- Never show a permanently spinning loader.  
\- Every failed operation needs a human-readable explanation and a retry path where retry is safe.  
\- Never expose raw Python exceptions, Firestore errors, Celery task IDs, stack traces, API keys, tokens, or internal IDs to normal users.  
\- Dangerous/destructive actions should always require explicit approval.  
\- Approval must be visually distinct from ordinary navigation.  
\- Clearly distinguish:  
  \- recommendation  
  \- proposed action  
  \- approved action  
  \- executed action  
  \- measured result  
  \- learning  
\- Use plain language first; technical details can live in an expandable section.  
\- Empty states must explain what the user should do next.  
\- Refreshing the browser during an agent run must not lose the run state.

1\. AUTHENTICATION  
\-----------------

LOGIN PAGE  
Required:  
\- Logo/product name  
\- Email input  
\- Password input  
\- Show/hide password control  
\- Log in button  
\- Link to registration  
\- Forgot-password path if implemented  
\- Loading state on submit  
\- Invalid credentials error  
\- Network/server error state

Optional:  
\- Remember session  
\- Password requirements/help

REGISTER PAGE  
Required:  
\- Name  
\- Email  
\- Password  
\- Confirm password  
\- Create account button  
\- Link to login  
\- Validation errors  
\- Loading state  
\- Duplicate email error  
\- Password mismatch error

2\. APP SHELL  
\------------

Persistent navigation should contain:  
\- Dashboard  
\- Businesses  
\- Agent Runs / Activity  
\- Opportunities  
\- Actions  
\- Measurements / Results  
\- Learnings  
\- Connections  
\- Settings  
\- Help/Feedback  
\- Logout

Top bar:  
\- Current business selector  
\- User/account menu  
\- Notifications/status area if implemented  
\- Mobile navigation control

Important:  
\- If only one business exists, still show the active business clearly.  
\- Never make the user guess which business an action belongs to.

3\. ONBOARDING  
\------------

First-time user experience:  
\- Welcome message  
\- Short explanation of what the agent does  
\- Primary CTA: Add your business  
\- Explain the basic loop:  
  Connect \-\> Analyze \-\> Discover opportunities \-\> Review \-\> Approve \-\> Execute \-\> Learn  
\- Explain that the user remains in control of actions.

Business creation form:  
\- Business name  
\- Website URL  
\- Industry  
\- Business description  
\- Create business button

Website URL requirements:  
\- Accept http/https URLs.  
\- Show clear invalid URL error.  
\- Normalize URL where appropriate.  
\- Tell user the website must be publicly reachable for the initial analysis.  
\- Do not expose SSRF/security implementation details.

After business creation:  
\- Automatically route to business overview or setup page.  
\- Show website URL.  
\- Show setup completeness.

4\. DASHBOARD  
\------------

Dashboard should answer four questions immediately:

A. What is happening?  
B. What did the agent find?  
C. What needs my approval?  
D. What happened previously?

Recommended sections:

BUSINESS HEADER  
\- Business name  
\- Website  
\- Industry  
\- Last analysis time  
\- Current agent status  
\- Primary CTA: Run Growth Analysis

AGENT STATUS CARD  
States:  
\- Ready  
\- Queued  
\- Analyzing  
\- Awaiting approval  
\- Executing  
\- Measuring  
\- Completed  
\- Failed

For each state show:  
\- Human-readable status  
\- Short explanation  
\- Relevant CTA

Example:  
"Your agent is analyzing your website and looking for growth opportunities."

RECENT OPPORTUNITIES  
Show:  
\- Opportunity title  
\- Type  
\- Potential impact  
\- Confidence  
\- Short problem statement  
\- Status  
\- View details CTA

PENDING ACTIONS  
Show:  
\- Action title  
\- Action type  
\- Related opportunity  
\- Why it was proposed  
\- Approval status  
\- Review CTA

RECENT RESULTS  
Show:  
\- Action  
\- Execution status  
\- Result  
\- Measurement  
\- Date

LEARNINGS  
Show:  
\- What the agent learned  
\- Confidence  
\- Source/result  
\- Date

5\. BUSINESS PAGE  
\----------------

Business overview:  
\- Business name  
\- Website  
\- Industry  
\- Description  
\- Created date  
\- Last analyzed  
\- Agent status  
\- Connection status

Actions:  
\- Edit business  
\- Run analysis  
\- View observations  
\- View opportunities  
\- View actions

Website preview/info:  
\- URL  
\- Last successful fetch  
\- Final URL after redirects if appropriate  
\- Basic website health/status

Do NOT render untrusted website HTML directly inside the app.

6\. START AGENT RUN  
\------------------

Primary CTA:  
"Run Growth Analysis"

Before starting:  
\- Show which business will be analyzed.  
\- Show website URL.  
\- Explain what the agent will do.  
\- Explain approximate scope:  
  \- Analyze public website content  
  \- Identify growth opportunities  
  \- Generate proposed actions  
  \- Ask for approval before actions  
\- Clearly state:  
  "The agent will not make changes without your approval."

After clicking:  
\- Disable duplicate start clicks.  
\- Show queued state.  
\- Display progress page/card.

7\. AGENT RUN / PROGRESS PAGE  
\----------------------------

This is one of the most important MVP screens.

Show a vertical timeline:

1\. Website observation  
   \- Queued  
   \- Running  
   \- Completed  
   \- Failed

2\. Website analysis  
   \- Queued  
   \- Running  
   \- Completed  
   \- Failed

3\. Opportunity discovery  
   \- Queued/running/completed/failed

4\. Action planning  
   \- Queued/running/completed/failed

5\. Review  
   \- Awaiting approval

6\. Execution  
   \- Queued/running/completed/failed

7\. Measurement  
   \- Recorded/not yet recorded

8\. Learning  
   \- Created/not yet created

Current MVP backend has separate:  
\- Overall run status  
\- Analysis status

UI should translate backend states into simple user-facing language.

Run status examples:  
\- queued: "Your growth analysis is queued."  
\- running: "Your agent is working."  
\- awaiting\_approval: "Your agent found actions for you to review."  
\- executing: "An approved action is being executed."  
\- measuring: "Recording the outcome."  
\- learning: "Updating what the agent knows."  
\- completed: "This growth cycle is complete."  
\- failed: "The growth cycle could not be completed."

Buttons:  
\- Back to dashboard (must not cancel the run)  
\- Refresh/status refresh  
\- View results when available

Failure:  
\- Friendly error message  
\- Retry only if safe  
\- Preserve previous successful data  
\- Never show stack traces

8\. OBSERVATION / WEBSITE ANALYSIS  
\---------------------------------

Show what the agent actually observed.

Possible sections:  
\- Website title  
\- Meta description  
\- Heading structure  
\- Important pages/links found  
\- Content signals  
\- Basic SEO signals  
\- Conversion signals  
\- Technical/content observations

Use a summary first:  
"Here's what the agent found on your website."

Then expandable details:  
\- Raw-ish technical observations  
\- Source URL  
\- Final URL  
\- Analysis timestamp

Do not overwhelm the user with raw HTML.

9\. OPPORTUNITIES PAGE  
\---------------------

Purpose:  
Turn observations into understandable growth opportunities.

Opportunity card must contain:  
\- Title  
\- Problem  
\- Why it matters  
\- Evidence  
\- Potential impact  
\- Confidence  
\- Opportunity type  
\- Status  
\- Related action(s)

Potential impact:  
\- Low  
\- Medium  
\- High

Confidence:  
\- Display as a simple percentage or confidence label.  
\- Avoid implying mathematical certainty.

Evidence:  
\- Show concise evidence.  
\- Allow expandable evidence details.

Types:  
\- Website  
\- Content  
\- SEO  
\- Conversion  
\- Social  
\- Other

Do not show "Social" opportunities as executable Instagram publishing if Instagram is not connected.

Opportunity detail page:  
\- Problem  
\- Evidence  
\- Explanation  
\- Potential impact  
\- Confidence  
\- Recommended next step  
\- Related actions  
\- Related execution/result/learning where available

10\. ACTIONS / RECOMMENDATIONS  
\-----------------------------

This is the main human-control screen.

Each action should show:  
\- Action title  
\- Action type  
\- Objective  
\- Description  
\- Reasoning  
\- Expected outcome  
\- Required inputs  
\- Requires approval  
\- Related opportunity  
\- Target/path when relevant  
\- Current status

Statuses:  
\- Pending approval  
\- Approved  
\- Running  
\- Completed  
\- Failed  
\- Rejected/cancelled only if those states are implemented

ACTION DETAIL PAGE  
Must answer:  
"What exactly is the agent asking me to approve?"

Show:

WHAT  
\- Action title

WHY  
\- Opportunity  
\- Reasoning

WHAT WILL HAPPEN  
\- Plain-language description

EXPECTED OUTCOME  
\- What improvement is expected

WHAT IS NEEDED  
\- Required inputs

WHERE  
\- Target page/path/repository if applicable

RISK / CONTROL  
\- "This action requires your approval."  
\- "The agent will not execute it until you approve."

For website dry-run actions:  
Show a prominent notice:  
"Dry-run mode: this action is being validated/prepared. No live website changes will be made."

Approval CTA:  
"Approve action"

Secondary CTA:  
"Back"

Optional:  
"Reject" / "Not now" if backend supports it.

11\. APPROVAL UX  
\---------------

Before approval:  
\- Clear confirmation step.  
\- Show exact action.  
\- Show what connector will be used.  
\- Show whether execution is live or dry-run.  
\- Show required inputs.

Approval button:  
\- Disabled while submitting.  
\- Shows "Approving..."  
\- Prevent double submission.

After approval:  
\- Show success confirmation.  
\- Show execution status.  
\- Move action from pending approval to approved.  
\- Do not ask user to approve the same action again.

If already approved:  
\- Display "Already approved."  
\- Show existing execution state.

If approval fails:  
\- Explain why.  
\- Do not claim it was approved.

12\. EXECUTION PAGE  
\------------------

Show:

Execution header:  
\- Action name  
\- Business  
\- Connector  
\- Execution status

Timeline:  
\- Approved  
\- Queued  
\- Running  
\- Completed/Failed

For website dry-run:  
\- "Validated successfully in dry-run mode."  
\- "No website changes were made."

Result section:  
\- Success/failure  
\- Human-readable message  
\- What was validated  
\- Required inputs still needed

Do not expose:  
\- Celery task ID  
\- Firestore execution ID  
\- internal exceptions

Optional expandable "Technical details" for developer/admin users only.

13\. MEASUREMENTS / RESULTS  
\--------------------------

Purpose:  
Show what was recorded after execution.

Measurement card:  
\- Metric  
\- Value  
\- Previous value if available  
\- Direction  
\- Source  
\- Date  
\- Related action

For current execution-success measurement:  
\- Metric: Execution success  
\- Value: 1  
\- Source: Execution engine

Translate technical values into:  
"Execution completed successfully."

Do not pretend execution success means business growth.  
Execution success only means the action pathway completed successfully.

14\. LEARNINGS PAGE  
\------------------

Purpose:  
Show how the agent is becoming more informed.

Learning card:  
\- Learning statement  
\- Learning type  
\- Outcome  
\- Confidence  
\- Source measurement  
\- Related action  
\- Date

Current operational learning example:  
"The action execution pathway completed successfully."

Clearly distinguish:  
\- Operational learning \= information about whether the system/action pathway worked.  
\- Marketing learning \= information about business/customer outcomes.

Do not claim a marketing improvement unless an actual marketing measurement supports it.

15\. AGENT CYCLE HISTORY  
\-----------------------

Show previous cycles.

Each run row/card:  
\- Date/time  
\- Business  
\- Status  
\- Opportunities found  
\- Actions created  
\- Actions approved  
\- Actions completed  
\- Measurement status  
\- Learning status  
\- View run

Filters:  
\- Date  
\- Status  
\- Business

Run detail:  
\- Observation  
\- Opportunities  
\- Actions  
\- Approval  
\- Execution  
\- Measurement  
\- Learning

16\. CONNECTIONS PAGE  
\--------------------

Show available integrations.

WEBSITE  
\- Connected automatically through business website URL  
\- Status  
\- Website URL  
\- Last successful analysis

GITHUB  
\- Connected/not connected  
\- Account  
\- Repository  
\- Default branch  
\- Connect GitHub button  
\- Disconnect button  
\- Connection health/status

INSTAGRAM  
\- Status: Coming later / Not available in MVP  
\- Explain briefly:  
  "Instagram integration is not enabled in this MVP."

Do not show fake connect buttons.

17\. SETTINGS  
\------------

Account:  
\- Name  
\- Email  
\- Password/security controls if implemented

Business settings:  
\- Business name  
\- Website  
\- Industry  
\- Description

Agent settings:  
\- Approval required  
\- Notification preferences  
\- Run preferences if implemented

Security:  
\- Active sessions/logout controls if implemented

Danger zone:  
\- Delete business  
\- Delete account  
\- Make destructive actions require confirmation

18\. NOTIFICATIONS  
\-----------------

Useful notification types:  
\- Agent run started  
\- Agent run completed  
\- Opportunities ready  
\- Action awaiting approval  
\- Action approved  
\- Execution completed  
\- Execution failed  
\- Measurement recorded  
\- Learning created

Each notification should link to the relevant screen.

Do not create noisy notifications for every internal state transition.

19\. GLOBAL ERROR STATES  
\-----------------------

INVALID WEBSITE:  
"Please enter a valid public website URL."

WEBSITE UNREACHABLE:  
"We couldn't reach this website. Check that the URL is correct and publicly accessible, then try again."

ANALYSIS FAILED:  
"We couldn't complete the website analysis. Your business data is safe. You can try again."

NO OPPORTUNITIES:  
"The agent didn't identify a strong growth opportunity from the available website information yet."

ACTION GENERATION FAILED:  
"We analyzed the website, but couldn't prepare an action. You can retry the analysis."

APPROVAL FAILED:  
"We couldn't approve this action. Please try again."

EXECUTION FAILED:  
"The approved action could not be completed. No successful execution was recorded."

AUTHENTICATION REQUIRED:  
"Your session has expired. Please sign in again."

PERMISSION ERROR:  
"You don't have permission to access this business."

SERVER ERROR:  
"Something went wrong on our side. Please try again."

20\. EMPTY STATES  
\----------------

NO BUSINESS:  
"Create your first business to start using the growth agent."

NO RUNS:  
"Run your first growth analysis to let the agent inspect your website."

NO OPPORTUNITIES:  
"No opportunities have been identified yet."

NO ACTIONS:  
"Actions will appear here after the agent identifies opportunities."

NO PENDING APPROVALS:  
"You're all caught up. No actions are waiting for approval."

NO RESULTS:  
"Execution results will appear here after an approved action runs."

NO LEARNINGS:  
"Learnings will appear after the agent measures completed actions."

NO GITHUB:  
"Connect GitHub when you want the agent to work with supported repository actions."

21\. LOADING STATES  
\------------------

Every async operation needs:  
\- Spinner/skeleton/progress indicator  
\- Clear status text  
\- Disabled duplicate actions  
\- Non-blocking navigation where safe

Examples:  
"Creating your business..."  
"Starting growth analysis..."  
"Analyzing website..."  
"Finding opportunities..."  
"Preparing recommended actions..."  
"Approving action..."  
"Queueing execution..."  
"Executing..."  
"Recording result..."  
"Updating agent learning..."

22\. RESPONSIVE UI  
\-----------------

Desktop:  
\- Sidebar navigation  
\- Main content  
\- Optional detail panel

Tablet:  
\- Collapsible navigation  
\- Cards stack naturally

Mobile:  
\- Bottom/nav drawer  
\- Full-width cards  
\- Sticky primary action where appropriate  
\- Approval CTA easy to reach  
\- Avoid giant tables

23\. ACCESSIBILITY  
\-----------------

Required:  
\- Keyboard navigation  
\- Visible focus states  
\- Proper labels  
\- Buttons must have meaningful text  
\- Status must not depend only on color  
\- Error messages associated with fields  
\- Sufficient text contrast  
\- Screen-reader-friendly status changes where possible  
\- Confirmation dialogs must be keyboard accessible

24\. TRUST / TRANSPARENCY  
\------------------------

The product should repeatedly communicate:

\- The agent analyzes information available to it.  
\- The agent proposes actions.  
\- The user controls approval.  
\- The agent must not silently execute unapproved actions.  
\- Dry-run actions do not change the user's website.  
\- Execution success does not automatically mean marketing success.  
\- Learnings are based on recorded measurements.

Avoid marketing claims such as:  
\- "Guaranteed growth"  
\- "Guaranteed customers"  
\- "Guaranteed SEO improvement"  
\- "Fully autonomous marketing" unless the product actually supports the claim.

25\. CORE MVP CTA HIERARCHY  
\--------------------------

Primary:  
\- Add business  
\- Run Growth Analysis  
\- Review Action  
\- Approve Action

Secondary:  
\- View opportunity  
\- View result  
\- View learning  
\- View history  
\- Connect GitHub

Avoid making every button visually primary.

26\. MVP DASHBOARD INFORMATION HIERARCHY  
\---------------------------------------

Top:  
1\. Business  
2\. Agent status  
3\. Primary next action

Middle:  
4\. Opportunities  
5\. Actions awaiting approval

Bottom:  
6\. Recent executions  
7\. Measurements  
8\. Learnings  
9\. Run history

The dashboard should always answer:  
"What should I do next?"

27\. FULL HAPPY-PATH USER TEST  
\-----------------------------

A new user should be able to perform:

1\. Register.  
2\. Log in.  
3\. Create business.  
4\. Paste website URL.  
5\. Save business.  
6\. Click Run Growth Analysis.  
7\. See queued/running state.  
8\. See completed analysis.  
9\. See opportunities.  
10\. Open an opportunity.  
11\. See proposed action.  
12\. Open action details.  
13\. See required inputs.  
14\. See approval requirement.  
15\. Approve action.  
16\. See execution queued.  
17\. See execution running.  
18\. See execution completed.  
19\. See dry-run result.  
20\. See measurement.  
21\. See learning.  
22\. Return to dashboard.  
23\. See updated history.  
24\. Run another analysis.  
25\. See that prior learning is available to the decision process.

28\. FULL FAILURE TEST  
\---------------------

Test these from the UI:

A. Invalid URL  
Expected:  
\- Inline validation  
\- No agent run created

B. Unreachable URL  
Expected:  
\- Run fails gracefully  
\- User sees retry option

C. Website with minimal content  
Expected:  
\- Analysis completes or fails gracefully  
\- No fake opportunities

D. Double-click Run Analysis  
Expected:  
\- No accidental duplicate runs

E. Refresh during analysis  
Expected:  
\- Run state persists

F. Double-click Approve  
Expected:  
\- Only one execution is created

G. Already approved action  
Expected:  
\- Existing approval/execution shown

H. Failed execution  
Expected:  
\- Action shows failed  
\- User sees useful error  
\- System does not pretend success

I. Unauthorized business  
Expected:  
\- Access denied  
\- No business data exposed

J. Expired session  
Expected:  
\- User is redirected to login  
\- No data mutation occurs

29\. ADMIN/DEVELOPER DEBUGGING INFORMATION  
\------------------------------------------

Normal users should NOT see internal IDs.

For a development/admin mode, optionally show:  
\- business\_id  
\- run\_id  
\- observation\_id  
\- opportunity\_id  
\- action\_id  
\- execution\_id  
\- Celery task ID  
\- timestamps  
\- connector name  
\- raw error

This should be hidden behind a developer/debug toggle.

30\. WHAT THE MVP UI SHOULD NOT CONTAIN  
\--------------------------------------

Do not add these just for the MVP:

\- Instagram publishing UI  
\- Meta Ads manager  
\- Google Ads manager  
\- TikTok publishing  
\- LinkedIn publishing  
\- Autonomous ad spending  
\- Full CRM  
\- Email campaign automation  
\- Complex attribution system  
\- Advanced ML dashboards  
\- Reinforcement learning dashboards  
\- Dozens of AI agent personalities  
\- Complex marketing automation builders  
\- Fake live website editing  
\- Fake analytics metrics  
\- Fake customer growth numbers

31\. MVP DEFINITION OF DONE  
\--------------------------

The UI is ready for real user testing when a stranger can:

\- Understand what the product does.  
\- Create a business.  
\- Paste a website.  
\- Start an analysis.  
\- Understand the agent's progress.  
\- Understand the opportunities found.  
\- Understand why an action is proposed.  
\- Approve an action.  
\- Understand whether execution succeeded.  
\- Understand that website execution is currently dry-run.  
\- See the measurement.  
\- See the learning.  
\- Return later and understand what happened.  
\- Recover from common errors without developer assistance.

32\. IDEAL USER-FACING COPY  
\--------------------------

Homepage/dashboard positioning:  
"Your AI growth manager finds opportunities across your business, recommends actions, and learns from the results."

Agent explanation:  
"Your agent analyzes your website, identifies growth opportunities, and prepares actions for your review."

Approval:  
"Review before execution. You stay in control of every action."

Dry-run:  
"Dry-run mode: this action is being validated. No live website changes will be made."

Learning:  
"Your agent records what happened so future decisions can use the result."

Execution success:  
"Action execution completed successfully."

Important distinction:  
"Execution success means the action pathway completed. It does not by itself mean your business metrics improved."

33\. GOOGLE SEARCH CONSOLE PREPARATION  
\-------------------------------------

When Google Search Console is integrated later, the UI should have room for:

Connection:  
\- Connect Google Search Console  
\- Select verified property  
\- Connection status  
\- Last sync

Search performance:  
\- Clicks  
\- Impressions  
\- CTR  
\- Average position  
\- Date range  
\- Queries  
\- Pages  
\- Countries/devices where available

AI interpretation:  
\- Search opportunities  
\- Pages losing visibility  
\- Queries with high impressions/low CTR  
\- Content gaps  
\- Ranking opportunities  
\- SEO recommendations

Important:  
\- Keep Search Console data clearly separated from website-only observations.  
\- Label source of every metric.  
\- Show date range.  
\- Do not imply causation from correlation alone.  
\- Preserve the same Observe \-\> Analyze \-\> Opportunity \-\> Action \-\> Approval \-\> Execute \-\> Measure \-\> Learn model.

34\. FINAL MVP USER JOURNEY  
\--------------------------

The cleanest final experience is:

LOGIN  
  ↓  
CREATE BUSINESS  
  ↓  
PASTE WEBSITE  
  ↓  
RUN GROWTH ANALYSIS  
  ↓  
AGENT WORKS  
  ↓  
OBSERVATION  
  ↓  
OPPORTUNITIES  
  ↓  
RECOMMENDED ACTIONS  
  ↓  
USER REVIEWS  
  ↓  
USER APPROVES  
  ↓  
EXECUTION  
  ↓  
RESULT  
  ↓  
MEASUREMENT  
  ↓  
LEARNING  
  ↓  
NEXT AGENT CYCLE

The UI should make this journey obvious without requiring the user to understand the backend architecture.

