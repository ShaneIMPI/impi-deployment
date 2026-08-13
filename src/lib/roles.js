import { supabase } from '../supabaseClient'

// Returns true if the signed-in user's email is in viewer_emails
// (read-only access). Mirrors the database RLS check, so the UI
// and the actual security boundary stay in sync.
export async function getIsViewer() {
  const { data: userData } = await supabase.auth.getUser()
  const email = userData?.user?.email
  if (!email) return false
  const { data } = await supabase
    .from('viewer_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  return !!data
}
