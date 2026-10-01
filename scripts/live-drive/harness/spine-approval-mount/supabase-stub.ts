/**
 * The spine's import chain reaches the real Supabase client, which throws `supabaseUrl is
 * required` with no env in a harness. Nothing on this plate reads the database — it renders a
 * transcript it is handed — so the stub exists only to keep the module graph loadable, and it
 * deliberately refuses rather than inventing a row: if anything on this surface ever starts
 * depending on a read, it should fail loudly here rather than render a fixture (§13).
 */
const refuse = async () => ({ data: null, error: { message: "harness: no database" } });
export const supabase = {
  rpc: refuse,
  from: () => ({ select: refuse, insert: refuse, update: refuse, delete: refuse }),
  functions: { invoke: refuse },
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
};
