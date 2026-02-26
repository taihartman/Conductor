import React from 'react';

export const SuppressedComponent: React.FC = () => {
  const items = [1, 2, 3];
  const scrollOffset = 100;

  return (
    <div
      style={{
        backgroundColor: 'rgba(255, 0, 0, 0.5)', // inline-ok
        color: '#ff0000', // inline-ok
        width: '200px', // inline-ok
        minHeight: '100px', // inline-ok
      }}
      title="Click to open settings" /* inline-ok */
      placeholder="Enter your name here" /* inline-ok */
    >
      {items.slice(0, 15).map((item) => ( // inline-ok
        <span key={item}>{item}</span>
      ))}
      {scrollOffset < 50 && <span>Near top</span>} {/* inline-ok */}
    </div>
  );
};
