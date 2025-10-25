const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('請設定 SUPABASE_URL 和 SUPABASE_SERVICE_KEY 環境變數');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
