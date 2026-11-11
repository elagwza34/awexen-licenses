import { Body, Controller, Post } from '@nestjs/common';
import { IsBoolean, IsInt, Min, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentAdmin, Public, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { PmsInstallationsService } from './pms-installations.service';
class ServerRequest { @IsString() @Length(10,64) licenseKey!:string; @IsString() @Length(8,500) serverFingerprint!:string; }
class RegisterRequest extends ServerRequest { @IsBoolean() approveReplacement!:boolean; @IsString() @MaxLength(400) reason!:string; }
class WorkstationRequest { @IsString() @Length(10,64) licenseKey!:string; @IsUUID() serverInstanceId!:string; @IsString() @Length(8,500) deviceFingerprint!:string; @IsString() @Length(200,4096) devicePublicKey!:string; @IsOptional() @IsString() @MaxLength(180) deviceName?:string; @IsOptional() @IsString() @MaxLength(40) appVersion?:string; @IsOptional() @IsString() @MaxLength(40) platform?:string; @IsOptional() @IsString() @MaxLength(80) osVersion?:string; }
class ResetRequest { @IsString() @Length(10,64) licenseKey!:string; @IsInt() @Min(1) deviceId!:number; @IsString() @Length(10,400) reason!:string; }
@Controller('pms-installations')
export class PmsInstallationsController {
  constructor(private readonly service:PmsInstallationsService){}
  @Post('register-server') @RequirePermissions('licenses.update')
  register(@Body() input:RegisterRequest,@CurrentAdmin() admin:AuthAdmin){return this.service.register(input.licenseKey,input.serverFingerprint,input.approveReplacement,input.reason,admin);}
  @Post('reset-workstation') @RequirePermissions('devices.reset')
  reset(@Body() input:ResetRequest,@CurrentAdmin() admin:AuthAdmin){return this.service.reset(input.licenseKey,input.deviceId,input.reason,admin);}
  @Public() @Post('server-grant') @Throttle({default:{limit:30,ttl:60000}})
  server(@Body() input:ServerRequest){return this.service.serverGrant(input.licenseKey,input.serverFingerprint);}
  @Public() @Post('workstations/validate') @Throttle({default:{limit:60,ttl:60000}})
  workstation(@Body() input:WorkstationRequest){return this.service.validate(input);}
  @Public() @Post('workstations/status') @Throttle({default:{limit:120,ttl:60000}})
  status(@Body() input:WorkstationRequest){return this.service.status(input);}
}
