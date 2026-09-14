/**
 * Vendify — Supabase browser configuration.
 *
 * IMPORTANT:
 * - This is the public anon key, intentionally shipped to the browser.
 * - Security must be enforced with RLS/RPC backend rules.
 * - Never put a service_role key here.
 */
const SUPABASE_URL = "https://puhkmblnptntorwptvld.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1aGttYmxucHRudG9yd3B0dmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MTcxMTEsImV4cCI6MjEwMzE5MzExMX0.k5zICWroYkhh3YCCspQpnAB0yXoFVrYo1JkcFQfP79o";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
