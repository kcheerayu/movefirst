// Uses REST directly so this one-time command also works on Node 20.
const email=process.env.OWNER_EMAIL?.trim().toLowerCase();
const url=process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!email||!url||!serviceKey){console.error("Set OWNER_EMAIL, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.");process.exit(1);}
const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"};
async function request(path,options={}){const response=await fetch(`${url}${path}`,{...options,headers:{...headers,...options.headers}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.message||body?.msg||`Request failed (${response.status})`);return body;}
const owners=await request("/rest/v1/profiles?select=id,roles!inner(key)&roles.key=eq.OWNER");
if(owners.length){console.error("An OWNER profile already exists. Bootstrap is intentionally single-use.");process.exit(1);}
const authUsers=await request("/auth/v1/admin/users?per_page=1000");const user=authUsers.users.find((entry)=>entry.email?.toLowerCase()===email);
if(!user){console.error("No Auth user matches OWNER_EMAIL. Create the user in Supabase Auth first.");process.exit(1);}
const roles=await request("/rest/v1/roles?select=id&key=eq.OWNER");if(!roles[0])throw new Error("OWNER role missing");
const fullName=String(user.user_metadata?.full_name||email.split("@")[0]);
await request("/rest/v1/profiles?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:user.id,full_name:fullName,role_id:roles[0].id,status:"active"})});
await request("/rest/v1/activity_logs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({actor_id:user.id,action:"OWNER_BOOTSTRAPPED",entity_type:"profile",entity_id:user.id})});
console.log(`OWNER profile created for ${email}.`);
