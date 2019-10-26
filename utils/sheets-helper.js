const readline = require('readline');
const { google } = require('googleapis');
const fs = require('fs');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const spreadsheetId = '1kTlvBbBJjmjLva9257DHPy7Fm41Uc8ZXk_oSitokYsc';

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
  const name = args.username;
  const date = args.date;

  const sheets = google.sheets({ version: 'v4', auth });

  sheets.spreadsheets.values.get(
    {
      spreadsheetId,
      range: 'RaidScheduleReactions!A:Z'
    },
    (err, res) => {
      if (err) {
        return console.log('The API returned an error: ' + err);
      }

      const rows = res.data.values;
      if (rows.length) {
        dates = rows[0]; // dates are on the first row
        names = rows.map(row => {
          return row[0]; // names are in the first column
        });

        const rowNumOfName = getRowNumOfName(names, name, sheets);
        let colNumOfDate;
      } else {
        console.log('No data found.');
      }
    }
  );
}

function negativeResponse(auth, args) {}

// Returns the row number containing the reacting users name
function getRowNumOfName(names, name, sheets) {
  let rowNumOfName;
  if (names.includes(name)) {
    rowNumOfName = names.indexOf(name) + 1;
  } else {
    // If the name doesn't exist in the spreadsheet then add it to the last row
    rowNumOfName = names.length + 1;
    addNameToSheet(sheets, rowNumOfName, name);
  }

  return rowNumOfName;
}

/* Performs an update to the spreadsheet, inserting the name of the person reacting into the last row
There could potentially be an issue with overwriting a name written by another event that happens in a 
very close time frame */
function addNameToSheet(sheets, nameRow, name) {
  sheets.spreadsheets.values.update(
    {
      spreadsheetId,
      range: `RaidScheduleReactions!A${nameRow}`,
      valueInputOption: 'RAW',
      resource: { values: [[name]] }
    },
    (err, res) => {
      if (err) {
        console.log(err);
      } else {
        console.log(`Added ${name} to the sheet.`);
      }
    }
  );
}

module.exports = { positiveResponse, authorize };
