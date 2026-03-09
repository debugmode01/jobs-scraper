import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../constants/user.constants';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Create a new user (Admin Only)' })
    @ApiResponse({ status: 201, description: 'The user has been successfully created.' })
    @ApiResponse({ status: 409, description: 'Conflict: User with this email already exists.' })
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Post('register')
    @ApiOperation({ summary: 'Register a new user (Public)' })
    @ApiResponse({ status: 201, description: 'The user has been successfully registered.' })
    @ApiResponse({ status: 409, description: 'Conflict: User with this email already exists.' })
    register(@Body() createUserDto: CreateUserDto) {
        // Force role to USER upon self registration to prevent spoofing
        createUserDto.role = UserRole.USER;

        // Prevent setting admin-only system keys on registration
        if (createUserDto.system) {
            delete createUserDto.system.emailVerified;
            delete createUserDto.system.isActive;
        }

        return this.usersService.create(createUserDto);
    }

    @Get('getall')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Retrieve all users (Admin Only)' })
    @ApiResponse({ status: 200, description: 'Returns an array of users.' })
    findAll() {
        return this.usersService.findAll();
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.USER) // Both can access, but we restrict it inside
    @ApiOperation({ summary: 'Retrieve a specific user by id' })
    @ApiResponse({ status: 200, description: 'Returns the user matched by id.' })
    @ApiResponse({ status: 403, description: 'Forbidden.' })
    @ApiResponse({ status: 404, description: 'User not found.' })
    findOne(@Param('id') id: string, @Req() req: any) {
        // If the user is not an Admin, they can only view their own ID
        if (req.user.role !== UserRole.ADMIN && req.user._id !== id) {
            throw new ForbiddenException('You are not allowed to view other users data.');
        }
        return this.usersService.findOne(id);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.USER) // Both can access, but we restrict it inside
    @ApiOperation({ summary: 'Update a specific user by id' })
    @ApiResponse({ status: 200, description: 'The user has been successfully updated.' })
    @ApiResponse({ status: 403, description: 'Forbidden.' })
    @ApiResponse({ status: 404, description: 'User not found.' })
    update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Req() req: any) {
        // If the user is not an Admin
        if (req.user.role !== UserRole.ADMIN) {
            // 1. They can only update their own ID
            if (req.user._id !== id) {
                throw new ForbiddenException('You are not allowed to update other users data.');
            }
            // 2. Prevent role escalation
            if (updateUserDto.role) {
                throw new ForbiddenException('You cannot change your own role.');
            }
            // 3. Prevent modifying admin-only system keys
            if (updateUserDto.system) {
                delete updateUserDto.system.emailVerified;
                delete updateUserDto.system.isActive;
            }
        }

        return this.usersService.update(id, updateUserDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Delete a specific user by id (Admin Only)' })
    @ApiResponse({ status: 200, description: 'The user has been successfully deleted.' })
    @ApiResponse({ status: 404, description: 'User not found.' })
    remove(@Param('id') id: string) {
        return this.usersService.remove(id);
    }
}