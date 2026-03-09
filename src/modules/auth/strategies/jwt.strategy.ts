import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { UserDocument } from '../../../schemas/user.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private userService: UsersService,
        private configService: ConfigService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') || 'super_secret_fallback_key', // Ensure a secret exists
        });
    }

    async validate(payload: any) {
        // Basic verification - checking if user actually exists in DB to prevent dangling tokens
        const user = await this.userService.findOne(payload.sub || payload._id) as UserDocument;

        if (!user) {
            throw new UnauthorizedException('Invalid token or user no longer exists');
        }

        // We can extract necessary role details cleanly.
        return {
            _id: String(user._id) || payload.sub || payload._id,
            email: user.email,
            role: user.role
        };
    }
}
