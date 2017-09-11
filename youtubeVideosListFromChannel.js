var _ = require('lodash');
var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');

// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/youtube-nodejs-quickstart.json
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/spreadsheets'];

var CONF = require('./conf.js');
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = CONF.TOKEN_PATH;

// Load client secrets from a local file.
fs.readFile(CONF.CLIENT_SECRET, function processClientSecrets(err, content) {
    if (err) {
        console.log('Error loading client secret file: ' + err);
        return;
    }
    // Authorize a client with the loaded credentials, then call the YouTube API.
    // authorize(JSON.parse(content), getChannel);
    authorize(JSON.parse(content), storeChannelVideos);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, "utf8", function(err, tokenData) {
        var token = JSON.parse(tokenData).token
        if(token === "") {
            getNewToken(oauth2Client, callback);
        } else {
            oauth2Client.credentials = token;
            callback(oauth2Client);
        }
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    console.log('Authorize this app by visiting this url: ', authUrl);
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter the code from that page here: ', function(code) {
        rl.close();
        oauth2Client.getToken(code, function(err, token) {
            if (err) {
                console.log('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            callback(oauth2Client);
        });
    });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
    var tokenData = {
        token: token
    };
    fs.writeFile(TOKEN_PATH, JSON.stringify(tokenData));
    console.log('Token stored to ' + TOKEN_PATH);
}

function storeChannelVideos(auth) {
    var service = google.youtube('v3');
    getChannelPlaylistId(service, auth, getChannelVideos);
}

function getChannelPlaylistId(service, auth, next) {
    service.channels.list({
        auth: auth,
        part: 'contentDetails',
        id: CONF.CHANNEL_ID
    }, function (err, response) {
        var allPlaylists = response.items[0].contentDetails.relatedPlaylists;
        var uploadsId = allPlaylists.uploads;
        console.log('These are the uploads of the channel ' + CONF.CHANNEL_ID + ' : ' + uploadsId);
        next(service, {
            auth: auth,
            part: 'snippet,contentDetails',
            playlistId: uploadsId,
            maxResults: CONF.MAX_RESULTS
        }, 2);
    });
}

function getNextPageVideosIfAvailable(response, reqObj, service, initRange) {
    var hasNextPageToken = _.has(response, 'nextPageToken');
    if (hasNextPageToken) {
        var nextPageToken = _.get(response, 'nextPageToken');
        reqObj['pageToken'] = nextPageToken;
        console.log('next token', nextPageToken);
        getChannelVideos(service, reqObj, initRange);
    }
}

function getChannelVideos(service, reqObj, initRange) {
    console.log('init range', initRange);
    service.playlistItems.list(reqObj, function (err, response) {
        if (err) {
            console.log('The API returned an error: ' + err);
            return;
        }
        var videos = response.items;
        var getNextVideos = _.partial(getNextPageVideosIfAvailable, response, reqObj, service);

        // update the excel
        var sheets = google.sheets('v4');
        var sheetsReqObj = {
            auth: reqObj.auth,
            spreadsheetId: CONF.SPREADSHEET_ID,
            valueInputOption: 'USER_ENTERED'
        };
        updateGoogleSheet(sheets, sheetsReqObj, videos, initRange, getNextVideos);
    });
}

function updateGoogleSheet(service, reqObj, videoData, initRangeRow, getNextVideos) {
    var range = 'Sheet1!A' + initRangeRow;
    var values = [];
    var size = videoData.length;

    // console.log(videoData[0]);
    // video title: videoData[0].snippet.title
    // video id: videoData[0].snippet.resourceId.videoId
    // video id: videoData[0].snippet.videoPublishedAt

    _.each(videoData, function (video) {
        var row = [];
        row.push(video.snippet.title);
        row.push(CONF.YOUTUBE_VIDEO_PRE_LINK + video.snippet.resourceId.videoId);
        row.push(video.snippet.publishedAt);
        values.push(row);
    });

    // appending more details
    reqObj['resource'] = {
        range: range,
        majorDimension: 'ROWS',
        values: values
    };
    reqObj['range'] = range;

    service.spreadsheets.values.update(reqObj, function (err, response) {
        if(err) {
            console.log('The Sheets API returned an error: ', err);
            return;
        }
        console.log(response);
        getNextVideos(initRangeRow + size);
    });
}