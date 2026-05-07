module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json-summary', 'text', 'lcov'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/index.js'
  ]
};
