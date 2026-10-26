const fs = require('fs');
const initSqlJs = require('sql.js');

initSqlJs().then(SQL => {
  const filebuffer = fs.readFileSync('C:/Users/Administrator/AppData/Roaming/9router/db/data.sqlite');
  const db = new SQL.Database(filebuffer);
  const rows = db.exec("SELECT model, provider, status, response, providerRequest, createdAt FROM requestDetails ORDER BY id DESC LIMIT 5");
  if (rows[0]) {
    for (const val of rows[0].values) {
      console.log('--- Row ---');
      console.log('Model:', val[0], 'Provider:', val[1], 'Status:', val[2], 'Created:', val[5]);
      console.log('Response:', val[3]);
      console.log('ProviderRequest:', (val[4] || '').slice(0, 300));
    }
  } else {
    console.log('No rows in requestDetails');
  }
});
