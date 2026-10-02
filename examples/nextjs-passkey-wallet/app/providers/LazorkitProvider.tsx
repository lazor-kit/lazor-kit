'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { lazorkit } from '../lib/lazorkit';

interface LazorkitContextType {
  lazorkit: typeof lazorkit;
}

const LazorkitContext = createContext<LazorkitContextType | undefined>(undefined);

interface LazorkitProviderProps {
  children: ReactNode;
}

/**
 * LazorkitProvider wraps the app and provides access to the Lazorkit SDK
 * 
 * Usage:
 * 