import React from 'react';

export const BadComponent: React.FC = () => {
  const items = [1, 2, 3];
  const scrollOffset = 100;

  return (
    <div
      style={{
        backgroundColor: 'rgba(255, 0, 0, 0.5)',
        color: '#ff0000',
        width: '200px',
        minHeight: '100px',
      }}
      title="Click to open settings"
      placeholder="Enter your name here"
    >
      {items.slice(0, 15).map((item) => (
        <span key={item}>{item}</span>
      ))}
      {scrollOffset < 50 && <span>Near top</span>}
    </div>
  );
};
