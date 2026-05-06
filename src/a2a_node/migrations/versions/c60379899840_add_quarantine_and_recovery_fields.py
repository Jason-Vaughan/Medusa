"""add_quarantine_and_recovery_fields

Revision ID: c60379899840
Revises: cffaf6555893
Create Date: 2026-05-05 21:36:26.013193

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c60379899840'
down_revision: Union[str, Sequence[str], None] = 'cffaf6555893'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tasks', sa.Column('last_health_check', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tasks', 'last_health_check')
