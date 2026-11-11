/** Reject unsupported clients before activation; legacy plans retain their original compatibility. */
export function supportsPmsEntitlements(version?:string):boolean {
  if(!version||!/^\d+\.\d+\.\d+(?:\.\d+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version))return false;
  const [major,minor]=version.split('.').map(Number);return major>1||major===1&&minor>=4;
}
