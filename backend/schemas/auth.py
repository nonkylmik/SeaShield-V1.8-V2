from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    email: str
    name: str
    role: str


class LoginResponse(BaseModel):
    message: str
    user: UserResponse
