// PROTOTYPE: serves the relation-card prototype. All data is invented in the page; nothing reads GitHub.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({}));
