import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Calendar, Columns3, GanttChart, List, Star } from 'lucide-react';
import { viewIconFor } from '../viewIcons';

describe('viewIconFor', () => {
  it("shows a view without a chosen icon by its layout's icon", () => {
    assert.equal(viewIconFor(null, 'list'), List);
    assert.equal(viewIconFor(null, 'kanban'), Columns3);
    assert.equal(viewIconFor(null, 'timeline'), GanttChart);
    assert.equal(viewIconFor(null, 'calendar'), Calendar);
  });

  it('keeps a chosen icon', () => {
    assert.equal(viewIconFor('star', 'kanban'), Star);
  });

  it('reads an unknown stored icon as no icon', () => {
    assert.equal(viewIconFor('gone', 'kanban'), Columns3);
  });
});
