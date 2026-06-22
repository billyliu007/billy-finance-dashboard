import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { deleteJson, fetchJson, postJson, putJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { formatCurrencyValue, formatMoney, formatPercent, formatQty } from '../utils/formatters.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { normalizeText, sanitizeDecimalInput } from '../utils/strings.js';
import './WhatIfScenariosPage.css';