
# ============ DOCENTES ============

@app.route('/docentes')
def docentes():
    """Lista de docentes"""
    page = request.args.get('page', 1, type=int)
    search = request.args.get('search', '')
    
    query = Docente.query
    if search:
        query = query.filter(Docente.nombre.contains(search))
    
    docentes_list = query.order_by(Docente.nombre).paginate(
        page=page, per_page=20, error_out=False
    )
    
    return render_template('docentes.html', docentes=docentes_list, search=search)

@app.route('/docentes/<int:id>')
def docente_detalle(id):
    """Detalle de un docente con sus NRCs"""
    docente = Docente.query.get_or_404(id)
    nrcs = NRC.query.filter_by(docente_id=id).all()
    
    # Estadísticas
    stats = {
        'total_nrcs': len(nrcs),
        'total_estudiantes': sum(n.inscritos or 0 for n in nrcs),
        'nrcs_pendientes': len([n for n in nrcs if n.estado_revision == 'PENDIENTE']),
        'nrcs_aprobados': len([n for n in nrcs if n.estado_revision == 'APROBADO'])
    }
    
    return render_template('docente_detalle.html', docente=docente, nrcs=nrcs, stats=stats)

@app.route('/docentes/nuevo', methods=['POST'])
def docente_nuevo():
    """Crear nuevo docente"""
    nombre = request.form.get('nombre')
    identificacion = request.form.get('identificacion')
    email = request.form.get('email')
    departamento = request.form.get('departamento')
    
    if not nombre:
        flash('El nombre es requerido', 'error')
        return redirect(url_for('docentes'))
    
    docente = Docente(
        nombre=nombre,
        identificacion=identificacion,
        email=email,
        departamento=departamento
    )
    db.session.add(docente)
    db.session.commit()
    
    flash('Docente creado exitosamente', 'success')
    return redirect(url_for('docentes'))

# ============ REVISION NRC ============

@app.route('/revision-nrc')
def revision_nrc():
    """Revisión de NRCs"""
    page = request.args.get('page', 1, type=int)
    estado = request.args.get('estado', '')
    search = request.args.get('search', '')
    
    query = NRC.query
    
    if estado:
        query = query.filter_by(estado_revision=estado)
    if search:
        query = query.filter(
            db.or_(
                NRC.nrc.contains(search),
                NRC.titulo.contains(search),
                NRC.nombre_docente.contains(search)
            )
        )
    
    nrcs = query.order_by(NRC.fecha_carga.desc()).paginate(
        page=page, per_page=20, error_out=False
    )
    
    # Estadísticas para filtros
    stats = {
        'total': NRC.query.count(),
        'pendientes': NRC.query.filter_by(estado_revision='PENDIENTE').count(),
        'revisados': NRC.query.filter(NRC.estado_revision != 'PENDIENTE').count(),
        'aprobados': NRC.query.filter_by(estado_revision='APROBADO').count(),
        'rechazados': NRC.query.filter_by(estado_revision='RECHAZADO').count()
    }
    
    return render_template('revision_nrc.html', nrcs=nrcs, stats=stats, estado=estado, search=search)

@app.route('/revision-nrc/<int:id>', methods=['GET', 'POST'])
def revision_nrc_detalle(id):
    """Detalle y revisión de un NRC"""
    nrc = NRC.query.get_or_404(id)
    
    if request.method == 'POST':
        estado_anterior = nrc.estado_revision
        estado_nuevo = request.form.get('estado_revision')
        observaciones = request.form.get('observaciones')
        calificacion = request.form.get('calificacion')
        
        # Actualizar NRC
        nrc.estado_revision = estado_nuevo
        nrc.observaciones = observaciones
        nrc.calificacion = calificacion
        nrc.fecha_revision = datetime.utcnow()
        nrc.revisado_por = 'Administrador'  # En producción sería el usuario actual
        
        # Crear registro de revisión
        revision = RevisionNRC(
            nrc_id=nrc.id,
            estado_anterior=estado_anterior,
            estado_nuevo=estado_nuevo,
            observaciones=observaciones,
            calificacion=calificacion,
            revisado_por='Administrador'
        )
        db.session.add(revision)
        db.session.commit()
        
        flash(f'NRC {nrc.nrc} revisado exitosamente', 'success')
        return redirect(url_for('revision_nrc'))
    
    # Historial de revisiones
    historial = RevisionNRC.query.filter_by(nrc_id=id).order_by(RevisionNRC.fecha.desc()).all()
    
    return render_template('revision_nrc_detalle.html', nrc=nrc, historial=historial)

@app.route('/api/nrc/<int:id>/actualizar', methods=['POST'])
def api_actualizar_nrc(id):
    """API para actualizar NRC vía AJAX"""
    nrc = NRC.query.get_or_404(id)
    
    data = request.get_json()
    estado = data.get('estado_revision')
    observaciones = data.get('observaciones')
    calificacion = data.get('calificacion')
    
    estado_anterior = nrc.estado_revision
    
    nrc.estado_revision = estado
    nrc.observaciones = observaciones
    nrc.calificacion = calificacion
    nrc.fecha_revision = datetime.utcnow()
    nrc.revisado_por = 'Administrador'
    
    revision = RevisionNRC(
        nrc_id=nrc.id,
        estado_anterior=estado_anterior,
        estado_nuevo=estado,
        observaciones=observaciones,
        calificacion=calificacion,
        revisado_por='Administrador'
    )
    db.session.add(revision)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'NRC actualizado'})

# ============ NRC GLOBALES ============

@app.route('/nrc-globales')
def nrc_globales():
    """Vista global de todos los NRCs"""
    page = request.args.get('page', 1, type=int)
    sede = request.args.get('sede', '')
    facultad = request.args.get('facultad', '')
    estado = request.args.get('estado', '')
    
    query = NRC.query
    
    if sede:
        query = query.filter_by(sede=sede)
    if facultad:
        query = query.filter_by(facultad=facultad)
    if estado:
        query = query.filter_by(estado_revision=estado)
    
    nrcs = query.order_by(NRC.nrc).paginate(
        page=page, per_page=25, error_out=False
    )
    
    # Opciones para filtros
    sedes = db.session.query(NRC.sede).distinct().filter(NRC.sede.isnot(None)).all()
    facultades = db.session.query(NRC.facultad).distinct().filter(NRC.facultad.isnot(None)).all()
    
    # Resumen por sede
    resumen_sede = db.session.query(
        NRC.sede,
        db.func.count(NRC.id).label('total'),
        db.func.sum(NRC.inscritos).label('total_inscritos')
    ).group_by(NRC.sede).all()
    
    return render_template('nrc_globales.html', 
                         nrcs=nrcs, 
                         sedes=[s[0] for s in sedes],
                         facultades=[f[0] for f in facultades],
                         resumen_sede=resumen_sede,
                         filtros={'sede': sede, 'facultad': facultad, 'estado': estado})

@app.route('/api/nrcs/resumen')
def api_nrcs_resumen():
    """API para obtener resumen de NRCs"""
    total = NRC.query.count()
    por_estado = db.session.query(
        NRC.estado_revision,
        db.func.count(NRC.id)
    ).group_by(NRC.estado_revision).all()
    
    por_sede = db.session.query(
        NRC.sede,
        db.func.count(NRC.id)
    ).group_by(NRC.sede).all()
    
    return jsonify({
        'total': total,
        'por_estado': [{'estado': e, 'cantidad': c} for e, c in por_estado],
        'por_sede': [{'sede': s, 'cantidad': c} for s, c in por_sede if s]
    })
