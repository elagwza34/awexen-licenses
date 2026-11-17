import type { PrismaClient } from '@prisma/client';

export function planReleaseChannel(planId:number):string{return `stable-plan-${planId}`;}
export function compareReleaseVersions(a:string,b:string):number{
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<Math.max(left.length,right.length);i++){const difference=(left[i]??0)-(right[i]??0);if(difference)return Math.sign(difference);}
  return 0;
}
export async function latestEligibleRelease(db:Pick<PrismaClient,'appVersion'>,planIds:number[],platform='WINDOWS'){
  if(!planIds.length)return null;
  const rows=await db.appVersion.findMany({where:{status:'PUBLISHED',platform:platform as any,channel:{in:['stable',...planIds.map(planReleaseChannel)]}}});
  return rows.sort((a,b)=>compareReleaseVersions(b.version,a.version)||b.buildNumber-a.buildNumber)[0]??null;
}
