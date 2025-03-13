# app/api/users.py
from fastapi import APIRouter, HTTPException, Path, Depends
from typing import List, Dict, Any, Annotated, Optional
from sqlalchemy.orm import Session
from pydantic import BaseModel
from loguru import logger

from app.database.session import get_db
from app.database.models import User, UserSettings
from app.models import (
    UserCreate,
    UserUpdate,
    UserSettingsModel,
    UserResponse,
    UserSettingsResponse
)

router = APIRouter()

# Create a new user
@router.post("/", response_model=UserResponse)
async def create_user(user: UserCreate, db: Annotated[Session, Depends(get_db)]):
    with db as session:
        # Check if username already exists
        existing_user: User = session.query(User).filter(User.username == user.username).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already exists")
        
        # Create user with default settings
        new_user = User.create_with_settings(
            session,
            username=user.username,
            display_name=user.display_name,
            avatar=user.avatar
        )
        
        return UserResponse(**new_user.to_dict(), settings=new_user.settings.to_dict())

# Get all users
@router.get("/", response_model=List[UserResponse])
async def get_users(db: Annotated[Session, Depends(get_db)]):
    with db as session:
        users: List[User] = session.query(User).all()
        logger.info(users)
        return [UserResponse(**user.to_dict(), settings=user.settings.to_dict()) for user in users]

# Get user by ID
@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, db: Annotated[Session, Depends(get_db)]):
    with db as session:
        user: Optional[User] = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(**user.to_dict(), settings=user.settings.to_dict())

# Update user
@router.put("/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_update: UserUpdate, db: Annotated[Session, Depends(get_db)]):
    with db as session:
        user: Optional[User] = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update user fields if provided
        if user_update.display_name:
            user.display_name = user_update.display_name
        if user_update.avatar is not None:  # Allow empty string to clear avatar
            user.avatar = user_update.avatar
        
        session.commit()
        session.refresh(user)
        return UserResponse(**user.to_dict())

# Delete user
@router.delete("/{user_id}")
async def delete_user(user_id: str, db: Annotated[Session, Depends(get_db)]):
    with db as session:
        user: Optional[User] = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        session.delete(user)
        session.commit()
        return {"message": "User deleted successfully"}

# Get user settings
@router.get("/{user_id}/settings", response_model=UserSettingsResponse)
async def get_user_settings(user_id: str, db: Annotated[Session, Depends(get_db)]):
    with db as session:
        user: Optional[User] = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        settings = user.settings
        if not settings:
            raise HTTPException(status_code=404, detail="User settings not found")
        
        return UserSettingsResponse(**settings.to_dict())

# Update user settings
@router.put("/{user_id}/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    user_id: str, 
    settings_update: UserSettingsModel, 
    db: Annotated[Session, Depends(get_db)]
):
    with db as session:
        user: Optional[User] = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        settings = user.settings
        if not settings:
            # Create settings if they don't exist
            settings = UserSettings(user_id=user_id)
            session.add(settings)
        
        # Update settings with new values
        for key, value in settings_update.dict(exclude_unset=True).items():
            setattr(settings, key, value)
        
        session.commit()
        session.refresh(settings)
        return UserSettingsResponse(**settings.to_dict())