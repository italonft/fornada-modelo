// Preact 10.29.8 (licença MIT) e htm 3.1.1 (licença Apache 2.0), copiados sem mudanças além do caminho do import.
import { h, render, Fragment, createContext, cloneElement } from './preact.mjs';
import { useState, useEffect, useMemo, useRef, useCallback, useContext, useReducer, useLayoutEffect } from './hooks.mjs';
import htm from './htm.mjs';

export const html = htm.bind(h);
export { h, render, Fragment, createContext, cloneElement, useState, useEffect, useMemo, useRef, useCallback, useContext, useReducer, useLayoutEffect };
