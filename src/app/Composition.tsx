import { classCount, classCounts } from '../core/classes';
import { classStyle } from './ClassPicker';

/** "4 warriors, 2 mages, 2 paladins", each in its class colour, then how many didn't pick a class. */
export function Composition({
  people,
  classes,
  className = 'composition',
  lead,
}: {
  people: { cls: string }[];
  classes: string[];
  className?: string;
  lead?: string;
}) {
  if (classes.length === 0 || people.length === 0) return null;
  const counts = classCounts(people, classes);
  const unknown = people.length - counts.reduce((sum, c) => sum + c.n, 0);
  if (counts.length === 0) return null;
  return (
    <p className={className}>
      {lead && <span className="muted">{lead} </span>}
      {counts.map(({ cls, n }, i) => (
        <span key={cls}>
          {i > 0 && ', '}
          <span className="class-name" style={classStyle(cls)}>
            {classCount(cls, n)}
          </span>
        </span>
      ))}
      {unknown > 0 && <span className="muted">, and {unknown} who didn’t say</span>}
    </p>
  );
}
