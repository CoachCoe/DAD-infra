/**
 * Root Jest config: run each workspace's suite as its own project so each uses
 * the ts-jest transform + tsconfig local to that workspace. `dist/` build
 * output is never treated as a test source.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  projects: [
    '<rootDir>/packages/config',
    '<rootDir>/packages/pipeline-iam',
    '<rootDir>/apps/atm',
    '<rootDir>/apps/dad-main',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.*/dist/'],
};
