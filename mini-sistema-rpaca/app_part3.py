
# ============ CORREOS ============

@app.route('/correos')
def correos():
    """Gestión de correos"""
    page = request.args.get('page', 1, type=int)
    correos_list = CorreoEnviado.query.order_by(CorreoEnviado.fecha_envio.desc()).paginate(
        page=page, per_page=15, error_out=False
    )
    
    # Estadísticas
    stats = {
        'total_enviados': CorreoEnviado.query.count(),
        'a_docentes': CorreoEnviado.query.filter_by(tipo_destinatario='DOCENTE').count(),
        'a_coordinaciones': CorreoEnviado.query.filter_by(tipo_destinatario='COORDINACION').count()
    }
    
    # Docentes con correo
    docentes_con_email = Docente.query.filter(Docente.email.isnot(None)).all()
    
    # Departamentos únicos
    departamentos = db.session.query(NRC.departamento).distinct().filter(NRC.departamento.isnot(None)).all()
    
    return render_template('correos.html', 
                         correos=correos_list, 
                         stats=stats,
                         docentes=docentes_con_email,
                         departamentos=[d[0] for d in departamentos])

@app.route('/correos/enviar-docente', methods=['POST'])
def enviar_correo_docente():
    """Enviar correo a un docente"""
    docente_id = request.form.get('docente_id')
    asunto = request.form.get('asunto')
    mensaje = request.form.get('mensaje')
    incluir_reporte = request.form.get('incluir_reporte') == 'on'
    
    docente = Docente.query.get_or_404(docente_id)
    
    if not docente.email:
        flash(f'El docente {docente.nombre} no tiene correo registrado', 'error')
        return redirect(url_for('correos'))
    
    # Obtener NRCs del docente
    nrcs = NRC.query.filter_by(docente_id=docente_id).all()
    nrcs_ids = [n.id for n in nrcs]
    
    # Crear registro de correo
    correo = CorreoEnviado(
        destinatario=docente.email,
        tipo_destinatario='DOCENTE',
        asunto=asunto,
        contenido=mensaje,
        archivo_adjunto='reporte_nrcs.pdf' if incluir_reporte else None,
        nrcs_incluidos=str(nrcs_ids)
    )
    db.session.add(correo)
    db.session.commit()
    
    flash(f'Correo enviado a {docente.nombre} ({docente.email})', 'success')
    return redirect(url_for('correos'))

@app.route('/correos/enviar-coordinacion', methods=['POST'])
def enviar_correo_coordinacion():
    """Enviar correo a coordinación/departamento"""
    departamento = request.form.get('departamento')
    email_coordinacion = request.form.get('email_coordinacion')
    asunto = request.form.get('asunto')
    mensaje = request.form.get('mensaje')
    incluir_reporte = request.form.get('incluir_reporte') == 'on'
    
    # Obtener NRCs del departamento
    nrcs = NRC.query.filter_by(departamento=departamento).all()
    nrcs_ids = [n.id for n in nrcs]
    
    correo = CorreoEnviado(
        destinatario=email_coordinacion,
        tipo_destinatario='COORDINACION',
        asunto=asunto,
        contenido=mensaje,
        archivo_adjunto='reporte_departamento.pdf' if incluir_reporte else None,
        nrcs_incluidos=str(nrcs_ids)
    )
    db.session.add(correo)
    db.session.commit()
    
    flash(f'Correo enviado a coordinación de {departamento}', 'success')
    return redirect(url_for('correos'))

@app.route('/correos/enviar-masivo', methods=['POST'])
def enviar_correo_masivo():
    """Enviar correos masivos a docentes con NRCs pendientes"""
    asunto = request.form.get('asunto')
    mensaje = request.form.get('mensaje')
    
    # Obtener docentes con NRCs pendientes
    docentes_con_pendientes = db.session.query(Docente).join(NRC).filter(
        NRC.estado_revision == 'PENDIENTE',
        Docente.email.isnot(None)
    ).distinct().all()
    
    enviados = 0
    for docente in docentes_con_pendientes:
        nrcs = NRC.query.filter_by(docente_id=docente.id, estado_revision='PENDIENTE').all()
        nrcs_ids = [n.id for n in nrcs]
        
        correo = CorreoEnviado(
            destinatario=docente.email,
            tipo_destinatario='DOCENTE',
            asunto=asunto,
            contenido=mensaje,
            nrcs_incluidos=str(nrcs_ids)
        )
        db.session.add(correo)
        enviados += 1
    
    db.session.commit()
    flash(f'Se enviaron {enviados} correos a docentes con NRCs pendientes', 'success')
    return redirect(url_for('correos'))

# ============ REPORTES ============

@app.route('/reportes')
def reportes():
    """Generación de reportes"""
    tipo = request.args.get('tipo', 'docentes')
    
    if tipo == 'docentes':
        # Reporte por docentes
        docentes_data = []
        for docente in Docente.query.all():
            nrcs = NRC.query.filter_by(docente_id=docente.id).all()
            docentes_data.append({
                'docente': docente,
                'nrcs': nrcs,
                'total_nrcs': len(nrcs),
                'total_estudiantes': sum(n.inscritos or 0 for n in nrcs)
            })
        return render_template('reportes_docentes.html', docentes=docentes_data)
    
    elif tipo == 'departamentos':
        # Reporte por departamentos
        deptos = db.session.query(NRC.departamento).distinct().filter(NRC.departamento.isnot(None)).all()
        deptos_data = []
        for dept in [d[0] for d in deptos]:
            nrcs = NRC.query.filter_by(departamento=dept).all()
            docentes = db.session.query(Docente).join(NRC).filter(NRC.departamento == dept).distinct().count()
            deptos_data.append({
                'departamento': dept,
                'total_nrcs': len(nrcs),
                'total_docentes': docentes,
                'total_estudiantes': sum(n.inscritos or 0 for n in nrcs)
            })
        return render_template('reportes_departamentos.html', departamentos=deptos_data)
    
    else:
        # Reporte general
        return render_template('reportes_general.html')

# ============ API ============

@app.route('/api/docentes/buscar')
def api_buscar_docentes():
    """API para búsqueda de docentes"""
    q = request.args.get('q', '')
    docentes = Docente.query.filter(Docente.nombre.contains(q)).limit(10).all()
    return jsonify([{'id': d.id, 'nombre': d.nombre, 'email': d.email} for d in docentes])

@app.route('/api/nrcs/<string:nrc_numero>')
def api_get_nrc(nrc_numero):
    """API para obtener información de un NRC"""
    nrc = NRC.query.filter_by(nrc=nrc_numero).first_or_404()
    return jsonify(nrc.to_dict())

# ============ MAIN ============

if __name__ == '__main__':
    print("=" * 60)
    print("MINI SISTEMA RPACA - Para Presentación de Maestría")
    print("=" * 60)
    print("Accede en tu navegador: http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, host='0.0.0.0', port=5000)
