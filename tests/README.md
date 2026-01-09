# Unit Tests

This directory contains unit tests for the `@defra/delivery-info-arch-tooling` library.

## Test Structure

```
tests/
├── confluence/           # Confluence-related module tests
│   ├── utils.test.js
│   ├── github.test.js
│   ├── content-processor.test.js
│   ├── api-client.test.js
│   └── page-manager.test.js
└── pdf/                  # PDF export module tests
    └── index.test.js
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test suite
npm test -- --testPathPattern=utils
npm test -- --testPathPattern=pdf
```

## Test Coverage

Current coverage for tested modules:

| Module                        | Statements | Branches | Functions | Lines |
|-------------------------------|------------|----------|-----------|-------|
| `lib/confluence/lib/utils.js` | 100%       | 100%     | 100%      | 100%  |
| `lib/confluence/lib/github.js`| 100%       | 100%     | 100%      | 100%  |
| `lib/pdf/index.js`            | ~97%       | 100%     | 100%      | ~97%  |
| `lib/confluence/lib/api-client.js` | ~73%  | ~52%     | ~71%      | ~73%  |
| `lib/confluence/lib/content-processor.js` | ~75% | ~72% | ~62% | ~75% |
| `lib/confluence/lib/page-manager.js` | ~72% | ~74%   | ~89%      | ~71%  |

## Coverage Thresholds

The Jest configuration enforces minimum coverage thresholds for tested modules:

- **utils.js**: 100% coverage required (fully tested utility functions)
- **github.js**: 100% coverage required (fully tested GitHub integration)
- **pdf/index.js**: 95%+ coverage required
- **api-client.js**: 50%+ branches, 70%+ functions/lines/statements
- **content-processor.js**: 60%+ functions, 70%+ branches/lines/statements
- **page-manager.js**: 70%+ branches/lines/statements, 85%+ functions

## Pre-commit Hooks

Tests are automatically run before commits via Husky pre-commit hooks:

- Tests run only if test or library files are staged
- Linting is also performed on staged JavaScript files

## Writing Tests

### Test Structure

Each test file follows this pattern:

```javascript
/**
 * Unit tests for module-name.js
 */

// Import module to test
const { functionToTest } = require('../../lib/path/to/module')

// Mock dependencies
jest.mock('dependency', () => ({
  // mock implementation
}))

describe('module-name', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('functionToTest', () => {
    it('should do something', () => {
      // Test implementation
    })
  })
})
```

### Mocking Guidelines

1. **File System Operations**: Mock `fs.promises` for async file operations
2. **Child Process**: Mock `child_process.execSync` and `spawn`
3. **HTTP Requests**: Mock `global.fetch` for Confluence API calls
4. **External Dependencies**: Use `jest.mock()` for external packages

### Best Practices

1. **Clear Test Names**: Use descriptive test names that explain the scenario
2. **Arrange-Act-Assert**: Structure tests with setup, execution, and verification
3. **Isolated Tests**: Each test should be independent and not rely on others
4. **Mock Cleanup**: Always clear mocks in `beforeEach` to avoid test pollution
5. **Edge Cases**: Test both happy paths and error conditions

## Future Test Coverage

Modules that could benefit from additional test coverage:

- `lib/confluence/index.js` - Main Confluence publishing orchestrator
- `lib/confluence/lib/hierarchy-manager.js` - Page hierarchy management
- `lib/confluence/lib/image-handler.js` - Image and diagram handling
- `lib/confluence/markdown-to-atlas-doc.js` - Markdown to ADF conversion
- `lib/ppt/generate.js` - PowerPoint generation
- `lib/diagrams/` - Diagram export and conversion utilities

## Troubleshooting

### Test Failures

If tests fail:

1. Check that all dependencies are installed: `npm install`
2. Clear Jest cache: `npx jest --clearCache`
3. Run tests with verbose output: `npm test -- --verbose`

### Coverage Issues

If coverage thresholds are not met:

1. Run coverage report: `npm run test:coverage`
2. Check uncovered lines in the terminal output
3. Add tests for uncovered code paths
4. Adjust thresholds in `jest.config.js` if needed (with justification)

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm test

- name: Check coverage
  run: npm run test:coverage
```

The tests are fast (< 2 seconds) and don't require external services, making them ideal for continuous integration.
