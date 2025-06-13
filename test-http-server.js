// Quick test script for the HTTP server
// Run with: node test-http-server.js

const http = require('http');

const PORT = 3000;

console.log('Testing Google Tasks HTTP Server...\n');

// Test health endpoint
const options = {
  hostname: 'localhost',
  port: PORT,
  path: '/health',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`Health check status: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', data);
    console.log('\nServer is running! You can now test other endpoints.');
    console.log('\nExample commands:');
    console.log('- List tasks: curl http://localhost:3000/tasks');
    console.log('- Search tasks: curl "http://localhost:3000/tasks/search?q=meeting"');
    console.log('- Create task: curl -X POST http://localhost:3000/tasks -H "Content-Type: application/json" -d \'{"title":"Test Task"}\'');
  });
});

req.on('error', (error) => {
  console.error('Error connecting to server:', error.message);
  console.log('\nMake sure the server is running with:');
  console.log('npm run start:http');
});

req.end();