/** When a city name matches more than one place: one button per place ("Portland, OR"), biggest first. */
export function PlaceChoices({ choices, onChoice }: { choices: string[]; onChoice: (place: string) => void }) {
  return (
    <ul className="place-choices" aria-label="Places with that name">
      {choices.map((place) => (
        <li key={place}>
          <button type="button" onClick={() => onChoice(place)}>
            {place}
          </button>
        </li>
      ))}
    </ul>
  );
}
