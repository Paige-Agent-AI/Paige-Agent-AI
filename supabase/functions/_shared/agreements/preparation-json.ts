import {object} from '../sales-collections/primitives.ts';

/** Original canonicalPresentationJson, extracted without changing its byte or
 * refusal contract so browser preparation reuses ONE native field validator
 * without importing the server-only PDF renderer/financial formatter graph.
 * This source binding is never permission, approval or signing evidence. */
export function canonicalPresentationJson(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonicalPresentationJson).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalPresentationJson(value[key])).join(',')+'}';
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  throw Error('COMMERCIAL_PRESENTATION_UNAVAILABLE');
}
