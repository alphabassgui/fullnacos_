from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# Shared extension singletons. Initialised against the app in app.py once
# DATABASE_URL is present; see the guarded wiring there.
db = SQLAlchemy()
migrate = Migrate()
