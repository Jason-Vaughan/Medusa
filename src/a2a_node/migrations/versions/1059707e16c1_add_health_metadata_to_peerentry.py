"""Add health_metadata to PeerEntry

Revision ID: 1059707e16c1
Revises: 4c98f0d21f16
Create Date: 2026-04-26 14:31:23.002508

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1059707e16c1'
down_revision: Union[str, Sequence[str], None] = '4c98f0d21f16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('peers', sa.Column('health_metadata', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    # Column doesn't exist, so nothing to drop in the broken state
    pass
