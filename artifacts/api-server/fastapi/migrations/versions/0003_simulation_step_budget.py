"""Persist the total step budget for each flow simulation."""

from alembic import op
import sqlalchemy as sa

revision = "0003_simulation_step_budget"
down_revision = "0002_flow_runtime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chatmaster_flow_executions",
        sa.Column("steps_executed", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("chatmaster_flow_executions", "steps_executed")
