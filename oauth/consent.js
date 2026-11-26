// Homie — connect an AI assistant (#127). Supabase's OAuth server sends the
// browser here with ?authorization_id=…; this page signs the person in with
// their Homie email and password, refuses an account that isn't one of the
// household's grown-ups (D3 — the server refuses it on every call too), says
// plainly what the assistant gets and which company it goes to, then approves
// or denies. Each page that loads this pins its project (prod / nonprod):
// the request id alone doesn't say which one sent it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0';

/** Who makes an assistant, by the name it registered with. */
export function companyFor(app) {
  const n = String(app || '').toLowerCase();
  if (n.includes('claude')) return 'Anthropic, the company that makes Claude';
  if (n.includes('chatgpt') || n.includes('openai')) return 'OpenAI, the company that makes ChatGPT';
  return `the company that makes ${app || 'this assistant'}`;
}

/** A household's grown-up: full access (null, or a {full: true} link) —
    src/domain/access.ts normalizeAccess / src/assistant canConnectAssistant. */
export function isFullAccess(access) {
  return access === null || access === undefined || (typeof access === 'object' && !Array.isArray(access) && access.full === true);
}

export function startConsent({ url, key }) {
  const supabase = createClient(url, key);
  const authorizationId = new URLSearchParams(location.search).get('authorization_id');
  const $ = (id) => document.getElementById(id);
  const show = (id, on = true) => { $(id).hidden = !on; };
  const fail = (msg) => { $('error').textContent = msg; show('error'); };
  const views = ['signin', 'consent', 'refused', 'idle'];
  const only = (view) => views.forEach((v) => show(v, v === view));

  async function run() {
    show('error', false);
    if (!authorizationId) {
      only('idle');
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      only('signin');
      return;
    }
    const email = session.user?.email ?? '';
    document.querySelectorAll('[data-email]').forEach((el) => { el.textContent = email; });

    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) {
      fail("This request has expired or was already answered. Start again from your assistant.");
      return;
    }
    if (!('authorization_id' in data)) {
      location.href = data.redirect_url; // already allowed before
      return;
    }
    const app = data.client?.name || 'This assistant';
    document.querySelectorAll('[data-app]').forEach((el) => { el.textContent = app; });

    // The household the assistant will read: the account's first membership
    // with full access (the server picks the same one).
    const { data: memberships } = await supabase.from('household_user').select('household_id, access, created_at').order('created_at');
    const home = (memberships ?? []).find((m) => isFullAccess(m.access));
    if (!home) {
      only('refused');
      return;
    }
    const { data: hh } = await supabase.from('sync_row').select('payload').eq('household_id', home.household_id).eq('tbl', 'household').maybeSingle();
    const name = hh?.payload?.name;
    $('household').textContent = name ? `the ${name} household` : 'your household';
    $('company').textContent = companyFor(app);
    only('consent');
  }

  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    show('error', false);
    const { error } = await supabase.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value,
    });
    if (error) {
      fail("That email and password didn't match a Homie account.");
      return;
    }
    $('password').value = '';
    run().catch((err) => fail(String(err?.message ?? err)));
  });
  $('allow').addEventListener('click', async () => {
    $('allow').disabled = true;
    const { error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error) { $('allow').disabled = false; fail(error.message); }
  });
  const deny = async () => {
    const { error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) fail(error.message);
  };
  $('deny').addEventListener('click', deny);
  $('close').addEventListener('click', deny);
  document.querySelectorAll('[data-signout]').forEach((el) =>
    el.addEventListener('click', async () => {
      await supabase.auth.signOut();
      run().catch((err) => fail(String(err?.message ?? err)));
    }),
  );

  run().catch((err) => fail(String(err?.message ?? err)));
}
