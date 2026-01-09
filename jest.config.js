module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ],
  coverageThreshold: {
    // Set thresholds for tested modules
    'lib/confluence/lib/utils.js': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    },
    'lib/confluence/lib/github.js': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    },
    'lib/confluence/lib/content-processor.js': {
      branches: 70,
      functions: 60,
      lines: 70,
      statements: 70
    },
    'lib/confluence/lib/api-client.js': {
      branches: 50,
      functions: 70,
      lines: 70,
      statements: 70
    },
    'lib/confluence/lib/page-manager.js': {
      branches: 70,
      functions: 85,
      lines: 70,
      statements: 70
    },
    'lib/pdf/index.js': {
      branches: 100,
      functions: 100,
      lines: 95,
      statements: 95
    }
  },
  verbose: true,
  silent: false
}

