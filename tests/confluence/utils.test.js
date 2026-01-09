/**
 * Unit tests for confluence/lib/utils.js
 */

const {
  isNullOrEmpty,
  toNumeric,
  extractError,
  getJsonResultCount
} = require('../../lib/confluence/lib/utils')

describe('utils', () => {
  describe('isNullOrEmpty', () => {
    it('should return true for null', () => {
      expect(isNullOrEmpty(null)).toBe(true)
    })

    it('should return true for undefined', () => {
      expect(isNullOrEmpty(undefined)).toBe(true)
    })

    it('should return true for empty string', () => {
      expect(isNullOrEmpty('')).toBe(true)
    })

    it('should return true for whitespace-only string', () => {
      expect(isNullOrEmpty('   ')).toBe(true)
      expect(isNullOrEmpty('\t\n')).toBe(true)
    })

    it('should return false for non-empty string', () => {
      expect(isNullOrEmpty('hello')).toBe(false)
      expect(isNullOrEmpty('  hello  ')).toBe(false)
    })

    it('should return false for numbers', () => {
      expect(isNullOrEmpty(0)).toBe(false)
      expect(isNullOrEmpty(42)).toBe(false)
    })

    it('should return false for objects', () => {
      expect(isNullOrEmpty({})).toBe(false)
      expect(isNullOrEmpty([])).toBe(false)
    })
  })

  describe('toNumeric', () => {
    it('should convert valid string numbers', () => {
      expect(toNumeric('42')).toBe(42)
      expect(toNumeric('0')).toBe(0)
      expect(toNumeric('-10')).toBe(-10)
    })

    it('should convert numeric values', () => {
      expect(toNumeric(42)).toBe(42)
      expect(toNumeric(0)).toBe(0)
    })

    it('should return 0 for invalid values', () => {
      expect(toNumeric('abc')).toBe(0)
      expect(toNumeric('')).toBe(0)
      expect(toNumeric(null)).toBe(0)
      expect(toNumeric(undefined)).toBe(0)
      expect(toNumeric(NaN)).toBe(0)
    })

    it('should handle decimal strings (truncates to integer)', () => {
      expect(toNumeric('42.5')).toBe(42)
      expect(toNumeric('3.14')).toBe(3)
    })
  })

  describe('extractError', () => {
    it('should extract message from error object', () => {
      const error = { message: 'Something went wrong' }
      expect(extractError(error)).toBe('Something went wrong')
    })

    it('should extract error property if message not present', () => {
      const error = { error: 'Error occurred' }
      expect(extractError(error)).toBe('Error occurred')
    })

    it('should stringify object if neither message nor error present', () => {
      const error = { code: 500, status: 'failed' }
      expect(extractError(error)).toBe('{"code":500,"status":"failed"}')
    })

    it('should convert string to string', () => {
      expect(extractError('Simple error message')).toBe('Simple error message')
    })

    it('should handle null', () => {
      expect(extractError(null)).toBe('null')
    })

    it('should handle undefined', () => {
      expect(extractError(undefined)).toBe('undefined')
    })
  })

  describe('getJsonResultCount', () => {
    it('should return count from results array', () => {
      const json = { results: [{ id: 1 }, { id: 2 }, { id: 3 }] }
      expect(getJsonResultCount(json)).toBe(3)
    })

    it('should return 0 for empty results array', () => {
      const json = { results: [] }
      expect(getJsonResultCount(json)).toBe(0)
    })

    it('should return 0 if results is not an array', () => {
      const json = { results: 'not an array' }
      expect(getJsonResultCount(json)).toBe(0)
    })

    it('should return 0 if results property is missing', () => {
      const json = { other: 'data' }
      expect(getJsonResultCount(json)).toBe(0)
    })

    it('should return 0 for null', () => {
      expect(getJsonResultCount(null)).toBe(0)
    })

    it('should return 0 for undefined', () => {
      expect(getJsonResultCount(undefined)).toBe(0)
    })

    it('should return 0 for non-objects', () => {
      expect(getJsonResultCount('string')).toBe(0)
      expect(getJsonResultCount(42)).toBe(0)
      expect(getJsonResultCount([])).toBe(0)
    })
  })
})
