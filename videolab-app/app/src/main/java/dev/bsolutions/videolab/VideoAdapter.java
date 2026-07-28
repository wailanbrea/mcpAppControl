package dev.bsolutions.videolab

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView

class VideoAdapter(
    private val context: Context,
    private val videos: List<Video>
) : BaseAdapter() {

    override fun getCount(): Int = videos.size

    override fun getItem(position: Int): Any = videos[position]

    override fun getItemId(position: Int): Long = position.toLong()

    override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
        val view = convertView ?: LayoutInflater.from(context)
            .inflate(android.R.layout.simple_list_item_2, parent, false)

        val video = videos[position]

        val titleText = view.findViewById<TextView>(android.R.id.text1)
        val descText = view.findViewById<TextView>(android.R.id.text2)

        titleText.text = video.title
        descText.text = "${video.views} vistas • ${video.description.take(60)}..."

        return view
    }
}
