"""add capability profiles and workspace grants

Revision ID: 4de6ececf227
Revises: 1059707e16c1
Create Date: 2026-04-29 16:50:34.271585

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4de6ececf227'
down_revision: Union[str, Sequence[str], None] = '1059707e16c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('capability_profiles',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('allowed_patterns', sa.JSON(), nullable=True),
    sa.Column('denied_patterns', sa.JSON(), nullable=True),
    sa.Column('path_scope', sa.JSON(), nullable=True),
    sa.Column('approval_routing', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id', 'version')
    )
    op.create_index(op.f('ix_capability_profiles_id'), 'capability_profiles', ['id'], unique=False)
    op.create_table('workspace_grants',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('workspace_id', sa.String(), nullable=False),
    sa.Column('profile_id', sa.String(), nullable=False),
    sa.Column('profile_version', sa.Integer(), nullable=False),
    sa.Column('granted_by', sa.String(), nullable=False),
    sa.Column('scope', sa.String(), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('revoked', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_workspace_grants_id'), 'workspace_grants', ['id'], unique=False)
    op.create_index(op.f('ix_workspace_grants_workspace_id'), 'workspace_grants', ['workspace_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_workspace_grants_workspace_id'), table_name='workspace_grants')
    op.drop_index(op.f('ix_workspace_grants_id'), table_name='workspace_grants')
    op.drop_table('workspace_grants')
    op.drop_index(op.f('ix_capability_profiles_id'), table_name='capability_profiles')
    op.drop_table('capability_profiles')
