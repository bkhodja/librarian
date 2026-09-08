import React, { useEffect, useRef } from 'react';

/**
 * A <select> whose options change while it is on screen.
 *
 * React assigns a controlled select's value during commit, but when only the
 * children change it does not re-assert it — and the browser tracks the
 * selection by index. The filter options here are derived from the library, so
 * the background tagger inserting a tag, or metadata enrichment adding an
 * author, shifts every option after it and silently moves the selection: a
 * filter set to "python" was found showing "ruby" after a refresh.
 *
 * Re-applying the value after each render pins the selection to the value
 * rather than to a position.
 */
function FilterSelect({ value, onChange, options, placeholder, className, title }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && ref.current.value !== value) {
      ref.current.value = value;
    }
  });

  return (
    <select
      ref={ref}
      className={className}
      value={value}
      onChange={onChange}
      title={title}
      // Browsers restore form-control values across a reload, which put the
      // library behind a filter the user never set — a fresh load came up
      // showing only four books because the tag select had been restored.
      autoComplete="off"
    >
      <option value="">{placeholder}</option>
      {options.map(({ value: optionValue, label }) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

export default FilterSelect;
