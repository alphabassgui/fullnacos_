import os
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build


GOOGLE_SEARCH_CONSOLE_SCOPE = (
    "https://www.googleapis.com/auth/webmasters.readonly"
)

class GoogleSearchConsoleAPI:
    def __init__(self, credentials):
        self.credentials = credentials
        self.service = build(
            "searchconsole",
            "v1",
            credentials=credentials,
            cache_discovery=False,
        )

    @staticmethod
    def create_oauth_flow(state=None):
        client_config = {
            "web": {
                "client_id": os.environ[
                    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID"
                ],
                "client_secret": os.environ[
                    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"
                ],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [
                    os.environ[
                        "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI"
                    ]
                ],
            }
        }

        # No PKCE: this is a confidential client (has a client secret), so the
        # client_secret authenticates the token exchange. Disabling PKCE means
        # there is no code_verifier to carry across the OAuth round-trip, so the
        # callback needs nothing from the Flask session (mirrors the GitHub flow).
        flow = Flow.from_client_config(
            client_config,
            scopes=[GOOGLE_SEARCH_CONSOLE_SCOPE],
            state=state,
            autogenerate_code_verifier=False,
        )

        flow.redirect_uri = os.environ[
            "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI"
        ]

        return flow



    @staticmethod
    def get_authorization_url(state):
        flow = GoogleSearchConsoleAPI.create_oauth_flow(state=state)
        # No include_granted_scopes: it makes Google echo back any other scopes
        # the account has already granted, which trips oauthlib's "Scope has
        # changed" check during the token exchange.
        authorization_url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
        )
        return authorization_url


    @staticmethod
    def exchange_code_for_credentials(code, state):
        flow = GoogleSearchConsoleAPI.create_oauth_flow(state=state)
        flow.fetch_token(code=code)
        return flow.credentials




    @classmethod
    def from_refresh_token(
        cls,
        refresh_token,
        access_token=None,
        token_uri="https://oauth2.googleapis.com/token",
        token_expiry=None,
        scopes=None,
    ):
        from datetime import datetime

        credentials = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri=token_uri,
            client_id=os.environ[
                "GOOGLE_SEARCH_CONSOLE_CLIENT_ID"
            ],
            client_secret=os.environ[
                "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"
            ],
            scopes=scopes or [GOOGLE_SEARCH_CONSOLE_SCOPE],
        )

        if token_expiry:
            credentials.expiry = datetime.fromisoformat(
                token_expiry
            )

        if not credentials.valid:
            credentials.refresh(Request())

        return cls(credentials)

    def list_sites(self):
        response = self.service.sites().list().execute()
        return response.get("siteEntry", [])

    def get_search_analytics(
        self,
        site_url,
        start_date,
        end_date,
        dimensions=None,
        row_limit=100,
    ):
        """
        Retrieve Google Search performance data for a property.

        Dates must use YYYY-MM-DD format.
        Supported dimensions include query, page, country,
        device, and date.
        """
        request_body = {
            "startDate": start_date,
            "endDate": end_date,
            "rowLimit": row_limit,
        }

        if dimensions:
            request_body["dimensions"] = dimensions

        response = (
            self.service.searchanalytics()
            .query(
                siteUrl=site_url,
                body=request_body,
            )
            .execute()
        )

        return response.get("rows", [])
