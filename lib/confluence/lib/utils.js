/**
 * Utility functions for Confluence publishing
 * @module @defra/delivery-info-arch-tooling/confluence/utils
 */

/**
 * Check if value is null or empty
 * @param {*} value - Value to check
 * @returns {boolean} True if null, undefined, or empty string
 */
function isNullOrEmpty (value) {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && value.trim() === '')
}

/**
 * Safely convert value to numeric (defaults to 0 if not numeric)
 * @param {*} value - Value to convert
 * @returns {number} Numeric value or 0
 */
function toNumeric (value) {
  const num = parseInt(value, 10)
  return isNaN(num) ? 0 : num
}

/**
 * Extract error message from API response body
 * @param {Object|string} body - Response body
 * @returns {string} Error message
 */
function extractError (body) {
  if (typeof body === 'object' && body !== null) {
    return body.message || body.error || JSON.stringify(body)
  }
  return String(body)
}

/**
 * Extract result count from JSON response (safely handles null/empty)
 * @param {Object} json - JSON response
 * @returns {number} Result count
 */
function getJsonResultCount (json) {
  if (!json || typeof json !== 'object') {
    return 0
  }
  if (Array.isArray(json.results)) {
    return json.results.length
  }
  return 0
}

module.exports = {
  isNullOrEmpty,
  toNumeric,
  extractError,
  getJsonResultCount
}

