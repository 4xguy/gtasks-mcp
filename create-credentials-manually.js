#!/usr/bin/env node

// Manual credential creation script
// Use this if you have an existing access token and refresh token

const fs = require('fs');
const path = require('path');

console.log('Manual Google Tasks Credentials Setup');
console.log('=====================================\n');

console.log('If you have existing OAuth tokens (from another app or Postman), you can use this script to create the credentials file.\n');

console.log('You need the following information:');
console.log('1. Access Token (starts with ya29...)');
console.log('2. Refresh Token (starts with 1//...)');
console.log('3. Client ID');
console.log('4. Client Secret\n');

console.log('Example credentials.json format:');
const example = {
  "access_token": "ya29.a0AfH6...",
  "refresh_token": "1//0gLtV...",
  "scope": "https://www.googleapis.com/auth/tasks",
  "token_type": "Bearer",
  "expiry_date": Date.now() + 3600000 // 1 hour from now
};

console.log(JSON.stringify(example, null, 2));

console.log('\nTo create the file manually:');
console.log('1. Create a file named .gtasks-server-credentials.json');
console.log('2. Add your credentials in the format above');
console.log('3. Make sure to include the refresh_token for long-term access');

console.log('\nAlternatively, for Railway deployment:');
console.log('Set the GOOGLE_TASKS_CREDENTIALS environment variable with the JSON string above.');