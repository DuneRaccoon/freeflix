from typing import TypeVar, Union, List, Any, Generic, Optional, Type, Dict
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import Column, DateTime, func, select, inspect
import uuid
from datetime import datetime

from app.database.session import Base

T = TypeVar('T', bound='CRUDMixin')

def generate_uuid():
    """Generate a UUID string for primary keys."""
    return str(uuid.uuid4())

def camel_to_snake_case(name):
    """Convert CamelCase to snake_case."""
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

class CRUDMixin(Generic[T]):
    """Mixin that adds convenience methods for CRUD (create, read, update, delete) operations."""
    
    @classmethod
    def create(cls: Type[T], db: Session, commit: bool = True, **kwargs) -> T:
        """Create a new record and optionally save it to the database."""
        instance = cls(**kwargs)
        db.add(instance)
        if commit:
            try:
                db.commit()
                db.refresh(instance)
            except SQLAlchemyError as e:
                db.rollback()
                raise
        return instance

    @classmethod
    def get_by_id(cls, db: Session, id_: str) -> Optional[T]:
        """Get a record by its ID."""
        return db.query(cls).filter_by(id=id_).first()
    
    @classmethod
    def get(cls, db: Session, first: bool=True, **kwargs) -> Optional[Union[T, List[T]]]:
        """Get records by arbitrary filters."""
        query = db.query(cls).filter_by(**kwargs)
        return query.first() if first else query.all()
    
    @classmethod
    def get_all(cls, db: Session) -> List[T]:
        """Get all records."""
        return db.query(cls).all()
        
    @classmethod
    def filter(cls, db: Session, skip: int = 0, limit: int = 100, **filters) -> List[T]:
        """Get records with pagination and filters."""
        query = db.query(cls).filter_by(**filters)
        return query.offset(skip).limit(limit).all()

    def update(self, db: Session, commit: bool = True, **kwargs) -> T:
        """Update specific fields of a record."""
        for attr, value in kwargs.items():
            setattr(self, attr, value)
        if commit:
            try:
                db.commit()
                db.refresh(self)
            except SQLAlchemyError as e:
                db.rollback()
                raise
        return self
    
    def save(self, db: Session, commit: bool = True) -> T:
        """Save the record to the database."""
        db.add(self)
        if commit:
            try:
                db.commit()
                db.refresh(self)
            except SQLAlchemyError as e:
                db.rollback()
                raise
        return self

    def delete(self, db: Session, commit: bool=True, hard_delete: bool=False) -> bool:
        """Remove the record from the database or mark as deleted."""
        if not hard_delete and hasattr(self, 'deleted_at'):
            self.deleted_at = datetime.utcnow()
            if commit:
                try:
                    db.commit()
                    return True
                except SQLAlchemyError:
                    db.rollback()
                    raise
        else:
            try:
                db.delete(self)
                if commit:
                    db.commit()
                return True
            except SQLAlchemyError:
                if commit:
                    db.rollback()
                raise
        return False

    def to_dict(self) -> Dict[str, Any]:
        """Convert model instance to dictionary excluding unserializable fields."""
        return {c.name: getattr(self, c.name) 
                for c in self.__table__.columns 
                if c.name != 'deleted_at' and getattr(self, c.name) is not None}

class Model(CRUDMixin, Base):
    """Base model class that includes CRUD operations and common fields."""
    
    __abstract__ = True
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    
    @classmethod
    def __declare_last__(cls):
        """Called after mappings are configured"""
        # You can define hooks here to be executed after mappings are set up
        pass
    
    @property
    def is_deleted(self) -> bool:
        """Check if the record is marked as deleted."""
        return self.deleted_at is not None
    
    @property
    def tablename(cls):
        """Get the table name of the model."""
        return cls.__tablename__