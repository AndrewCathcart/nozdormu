const readline = require('readline');
const { google } = require('googleapis');
const fs = require('fs');

// If modifying these scopes, delete token.json.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 * @param {Object} args Optional
 */
function authorize(credentials, callback, args) {
  const {
    client_secret,
    client_id,
    redirect_uris
  } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client, args);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the code from that page here: ', code => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err)
        return console.error(
          'Error while trying to retrieve access token',
          err
        );
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function positiveResponse(auth, args) {
  console.log(args);

  const sheets = google.sheets({ version: 'v4', auth });
  sheets.spreadsheets.values.get(
    {
      spreadsheetId: '1kTlvBbBJjmjLva9257DHPy7Fm41Uc8ZXk_oSitokYsc',
      range: 'RaidScheduleReactions!A:Z'
    },
    (err, res) => {
      if (err) {
        return console.log('The API returned an error: ' + err);
      }
      const rows = res.data.values;
      if (rows.length) {
        dateRow = rows[0];
        nameCol = rows.map(row => {
          return row[0];
        });

        console.log(dateRow);
        console.log(nameCol);

        let nameRow;
        if (nameCol.includes(args.username)) {
          nameRow = nameCol.indexOf(args.username) + 1;
        } else {
          nameRow = nameCol.length + 1;
          // insert name into this row
        }
        console.log('name on row', nameRow);
      } else {
        console.log('No data found.');
      }
    }
  );
}

function negativeResponse(auth, args) {}

module.exports = { positiveResponse, authorize };