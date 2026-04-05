from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import uuid
from datetime import datetime
from app.api.a2a import verify_medusa_secret

router = APIRouter()

LEARNINGS_DIR = os.path.join(os.getcwd(), ".prawduct", "learnings")

class Learning(BaseModel):
    id: Optional[str] = None
    title: str
    content: str
    tags: List[str] = []
    timestamp: Optional[str] = None

@router.post("/", response_model=Learning)
async def create_learning(learning: Learning, authenticated: bool = Depends(verify_medusa_secret)):
    if not os.path.exists(LEARNINGS_DIR):
        os.makedirs(LEARNINGS_DIR, exist_ok=True)
    
    learning.id = str(uuid.uuid4())
    learning.timestamp = datetime.now().isoformat()
    
    file_path = os.path.join(LEARNINGS_DIR, f"{learning.id}.json")
    with open(file_path, "w") as f:
        json.dump(learning.dict(), f, indent=4)
    
    return learning

@router.get("/", response_model=List[Learning])
async def list_learnings(authenticated: bool = Depends(verify_medusa_secret)):
    if not os.path.exists(LEARNINGS_DIR):
        return []
    
    learnings = []
    for filename in os.listdir(LEARNINGS_DIR):
        if filename.endswith(".json"):
            file_path = os.path.join(LEARNINGS_DIR, filename)
            with open(file_path, "r") as f:
                learnings.append(json.load(f))
    
    return sorted(learnings, key=lambda x: x['timestamp'], reverse=True)

@router.get("/{learning_id}", response_model=Learning)
async def get_learning(learning_id: str, authenticated: bool = Depends(verify_medusa_secret)):
    file_path = os.path.join(LEARNINGS_DIR, f"{learning_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Learning not found")
    
    with open(file_path, "r") as f:
        return json.load(f)
