"""initial migration

Revision ID: 70d880b989e4
Revises: 
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '70d880b989e4'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create tasks table
    op.create_table(
        'tasks',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('task_type', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('context', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), server_default='pending'),
        sa.Column('priority', sa.Integer(), server_default='1'),
        sa.Column('assigned_to', sa.String(), server_default='local'),
        sa.Column('assigned_by', sa.String(), nullable=True),
        sa.Column('claimed_by', sa.String(), nullable=True),
        sa.Column('claim_timestamp', sa.DateTime(), nullable=True),
        sa.Column('parent_id', sa.String(), nullable=True, index=True),
        sa.Column('depends_on', sa.JSON(), nullable=True),
        sa.Column('subtask_count', sa.Integer(), server_default='0'),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('execution_metadata', sa.JSON(), nullable=True),
        sa.Column('bid_metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now())
    )

    # Create messages table
    op.create_table(
        'messages',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('sender_id', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('message_type', sa.String(), server_default='chat'),
        sa.Column('received_at', sa.DateTime(), server_default=sa.func.now())
    )

    # Create peers table
    op.create_table(
        'peers',
        sa.Column('id', sa.String(), primary_key=True, index=True),
        sa.Column('address', sa.String(), nullable=False),
        sa.Column('status', sa.String(), server_default='active'),
        sa.Column('last_seen', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('capabilities', sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_table('peers')
    op.drop_table('messages')
    op.drop_table('tasks')
