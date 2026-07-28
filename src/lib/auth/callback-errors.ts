export function isInvalidSupabaseApiKey(error:unknown){return typeof error==="object"&&error!==null&&"message" in error&&typeof error.message==="string"&&/invalid api key/i.test(error.message);}
