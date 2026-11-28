// PROTOTYPE: lets the relation-card prototype swap the issue document for one of its variants.
import type { ComponentType } from 'react';
import type { DocumentProps } from './IssueDetail';

export const prototypeIssueDocument: { current: ComponentType<DocumentProps> | null } = { current: null };
