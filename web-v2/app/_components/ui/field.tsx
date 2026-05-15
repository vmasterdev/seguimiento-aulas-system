'use client';

import React from 'react';

export interface FieldProps {
  label: string;
  children: React.ReactElement;
  className?: string;
  style?: React.CSSProperties;
}

export const Field: React.FC<FieldProps> = ({ label, children, className = '', style }) => {
  // Asegurar que el hijo tenga la clase base necesaria para recibir los estilos encapsulados
  const childWithClass = React.cloneElement(children, {
    className: `${children.props.className || ''} ui-field-input`.trim(),
  });

  return (
    <div className={`ui-field-container ${className}`.trim()} style={style}>
      <label className="ui-field-label">{label}</label>
      {childWithClass}
    </div>
  );
};
