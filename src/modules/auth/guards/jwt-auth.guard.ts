import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { UserRole } from '../../../constants/user.constants';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        const request = context.switchToHttp().getRequest();
        const path = request.path;

        // Example exception for public routes (e.g., uploads or health checks) if needed
        if (path.startsWith('/uploads')) {
            return true;
        }

        // No roles required means endpoint is public or just requires valid JWT
        if (!requiredRoles) {
            return super.canActivate(context);
        }

        return super.canActivate(context);
    }

    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        if (info?.name === 'TokenExpiredError') {
            throw new UnauthorizedException('User Token Expired');
        }
        if (err || !user) {
            throw err || new UnauthorizedException('User not authenticated');
        }

        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        // If no specific roles are required, simply return the valid user
        if (!requiredRoles) {
            return user;
        }

        // Role verification
        const currentRole = user?.role;
        const hasRole = requiredRoles.includes(currentRole);

        if (!hasRole) {
            throw new UnauthorizedException('User not allowed to access this resource. Proper permissions required.');
        }

        return user;
    }
}
